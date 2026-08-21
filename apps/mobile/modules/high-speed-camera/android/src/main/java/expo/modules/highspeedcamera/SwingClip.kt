package expo.modules.highspeedcamera

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * What happens to a take after the recorder closes the file: find the strike, cut around it.
 *
 * Both halves are deliberately dumb. **Detection only has to seed a window the golfer can slide**,
 * so ±0.5s is a success and a miss costs one drag — which is exactly why a cheap heuristic is
 * allowed here where it would not be allowed in the analyzer. Nothing in this file produces a
 * measurement: the real Impact frame comes from `events.py` and `club.refine_events`, which snap it
 * to the club-head low point and are strictly better than a human dragging a scrubber.
 *
 * The trim never re-encodes. It remuxes the sample range, so a 6s cut out of a 20s take costs
 * milliseconds and loses no quality.
 */
object SwingClip {

  private const val TAG = "SwingSageClip"

  /** Analysis window for short-time energy. 5ms at 44.1kHz is 220 samples — fine enough to
   *  resolve a strike's attack, coarse enough that a 20s clip is only 4,000 windows. */
  private const val WINDOW_MS = 5.0

  /**
   * How far above the running background a window must rise to be a candidate, in linear
   * amplitude ratio (~12 dB).
   *
   * Loudness alone is a poor discriminator — shouting, wind and a bag dropping all clear it. The
   * ATTACK test below is what actually separates a strike, and this only exists to keep the
   * candidate list short.
   */
  private const val PEAK_RATIO = 4.0

  /** How fast the background level forgets. Slow enough to survive a strike without absorbing it. */
  private const val BACKGROUND_ALPHA = 0.02

  /** Candidates closer together than this are the same event (a strike plus its own echo). */
  private const val MIN_SEPARATION_S = 0.35

  /** Ceiling on one audio decode. A 30s take's audio decodes in well under a second, so this
   * only ever fires on a malformed file — see the deadline in `decodeEnvelope`. */
  private const val DECODE_BUDGET_MS = 10_000L

  data class Impact(val timeSec: Double, val score: Double)

  // ------------------------------------------------------------------ detection

  /**
   * Candidate strike times in the clip, strongest-scoring first, at most `limit`.
   *
   * Empty is a normal answer — an indoor mat, a muted take, a windy range — and the caller is
   * expected to fall back to a default window rather than treat it as an error.
   */
  fun detectImpacts(path: String, limit: Int = 3): List<Impact> {
    val extractor = MediaExtractor()
    return try {
      extractor.setDataSource(path)
      val track = (0 until extractor.trackCount).firstOrNull { i ->
        extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: return emptyList()

      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      val envelope = decodeEnvelope(extractor, format, sampleRate, channels)
      pickImpacts(envelope, WINDOW_MS / 1000.0, limit)
    } catch (e: Throwable) {
      // A clip whose audio cannot be read still records a swing. Seeding is a convenience.
      Log.w(TAG, "impact detection failed: ${e.message}")
      emptyList()
    } finally {
      runCatching { extractor.release() }
    }
  }

  /**
   * Peak absolute amplitude per 5ms window across the whole track.
   *
   * PEAK rather than RMS on purpose: a strike is a single sharp spike, and averaging over a window
   * is exactly the operation that flattens it back into its neighbours.
   */
  private fun decodeEnvelope(
    extractor: MediaExtractor,
    format: MediaFormat,
    sampleRate: Int,
    channels: Int,
  ): DoubleArray {
    val mime = format.getString(MediaFormat.KEY_MIME) ?: return DoubleArray(0)
    // Created INSIDE the try whose finally releases it — a codec that fails to configure
    // (unsupported profile, corrupt format) otherwise leaks the native instance, silently,
    // on every take, because the caller catches and logs.
    val codec = MediaCodec.createDecoderByType(mime)
    try {
      codec.configure(format, null, null, 0)
      codec.start()
    } catch (e: Throwable) {
      runCatching { codec.release() }
      throw e
    }

    val samplesPerWindow = max(1, (sampleRate * WINDOW_MS / 1000.0).toInt())
    val out = ArrayList<Double>(4096)
    var windowPeak = 0.0
    var windowCount = 0

    val info = MediaCodec.BufferInfo()
    var sawInputEnd = false
    var sawOutputEnd = false

    // A truncated MP4 — the shape an interrupted take leaves behind — can decode without ever
    // emitting END_OF_STREAM. Unbounded, that spins forever on the module's queue and wedges
    // every later detectImpacts/clipThumbnails/trimClip on the same thread.
    val deadline = SystemClock.elapsedRealtime() + DECODE_BUDGET_MS

    try {
      while (!sawOutputEnd) {
        if (SystemClock.elapsedRealtime() > deadline) {
          Log.w(TAG, "audio decode exceeded ${DECODE_BUDGET_MS}ms — using what was decoded")
          break
        }
        if (!sawInputEnd) {
          val inIndex = codec.dequeueInputBuffer(10_000)
          if (inIndex >= 0) {
            val buf = codec.getInputBuffer(inIndex)!!
            val read = extractor.readSampleData(buf, 0)
            if (read < 0) {
              codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              sawInputEnd = true
            } else {
              codec.queueInputBuffer(inIndex, 0, read, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val outIndex = codec.dequeueOutputBuffer(info, 10_000)
        if (outIndex >= 0) {
          val buf: ByteBuffer? = codec.getOutputBuffer(outIndex)
          if (buf != null && info.size > 0) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            // 16-bit PCM. Channels are interleaved; take the max across them — a strike lands on
            // both, and mixing would only halve it.
            while (buf.remaining() >= 2 * channels) {
              var frameMax = 0
              for (c in 0 until channels) {
                val lo = buf.get().toInt() and 0xFF
                val hi = buf.get().toInt()
                frameMax = max(frameMax, abs((hi shl 8) or lo))
              }
              windowPeak = max(windowPeak, frameMax / 32768.0)
              if (++windowCount >= samplesPerWindow) {
                out.add(windowPeak)
                windowPeak = 0.0
                windowCount = 0
              }
            }
          }
          codec.releaseOutputBuffer(outIndex, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEnd = true
        }
      }
    } finally {
      runCatching { codec.stop() }
      runCatching { codec.release() }
    }

    if (windowCount > 0) out.add(windowPeak)
    return out.toDoubleArray()
  }

  /**
   * Windows that rise sharply out of their own background.
   *
   * Two tests, and the second is the one doing the work. **Ratio to background** keeps the list
   * short. **Attack** — this window against the one before it — is what distinguishes a strike from
   * every other loud thing at a driving range: a shout, a gust and a dropped bag are all loud and
   * none of them arrive in 5 milliseconds.
   */
  private fun pickImpacts(env: DoubleArray, windowSec: Double, limit: Int): List<Impact> {
    if (env.size < 4) return emptyList()

    var background = env.take(min(env.size, 40)).average().coerceAtLeast(1e-6)
    val found = ArrayList<Impact>()

    for (i in 1 until env.size) {
      val v = env[i]
      val prev = env[i - 1].coerceAtLeast(1e-6)
      val ratio = v / background
      val attack = v / prev
      if (ratio > PEAK_RATIO && attack > 2.0) {
        // Score rewards BOTH — a loud slow swell and a quiet sharp tick are each half a strike.
        found.add(Impact(i * windowSec, ratio * attack))
      }
      // The background never learns from the spike it is being used to detect.
      if (ratio < PEAK_RATIO) background = background * (1 - BACKGROUND_ALPHA) + v * BACKGROUND_ALPHA
    }

    // Collapse each strike and its echo into one candidate, keeping the strongest.
    val merged = ArrayList<Impact>()
    for (cand in found.sortedByDescending { it.score }) {
      if (merged.none { abs(it.timeSec - cand.timeSec) < MIN_SEPARATION_S }) merged.add(cand)
      if (merged.size >= limit) break
    }
    return merged
  }

  // ------------------------------------------------------------------ thumbnails

  /**
   * Evenly spaced frames across a take, written as JPEGs and returned as file paths.
   *
   * The filmstrip is what makes the scrubber a picture of the swing rather than a grey bar
   * (capture spec §04.3): the golfer finds their strike by SEEING it, and a plain track asks
   * them to find it by memory of when they swung.
   *
   * Deliberately cheap. `OPTION_CLOSEST_SYNC` snaps to keyframes, so each grab is a decode of
   * one already-independent frame instead of a seek-and-replay, and the strip is a coarse map
   * — being a few frames off the requested time costs nothing at this size. Never decode every
   * frame of a 240 fps take for this.
   */
  fun thumbnails(path: String, count: Int, width: Int, outDir: File): List<Map<String, Any>> {
    val source = File(path)
    require(source.exists()) { "no such clip: $path" }
    require(count > 0) { "count must be positive" }

    val retriever = MediaMetadataRetriever()
    val out = mutableListOf<Map<String, Any>>()
    try {
      retriever.setDataSource(source.absolutePath)
      val durationMs = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      if (durationMs <= 0L) return emptyList()

      val stem = source.nameWithoutExtension
      for (i in 0 until count) {
        // Sample at the MIDDLE of each cell, not its edge: a strip of N pictures represents N
        // spans of time, and the frame at a span's midpoint is the one that represents it.
        val atMs = (durationMs * (i + 0.5) / count).toLong()
        val frame = runCatching {
          // A square-ish box on BOTH axes: the take is a portrait-rotated 1080p file, and
          // asking for a 16:9 box made the retriever fit a portrait frame inside it — the
          // strip got ~90px-wide thumbnails from a 160px request. `getScaledFrameAtTime`
          // preserves aspect, so the larger box is the one that binds.
          retriever.getScaledFrameAtTime(
            atMs * 1000L,
            MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
            width,
            width,
          )
        }.getOrNull() ?: continue

        val file = File(outDir, "$THUMB_PREFIX${stem}_$i.jpg")
        val wrote = runCatching {
          FileOutputStream(file).use { frame.compress(Bitmap.CompressFormat.JPEG, 70, it) }
        }.isSuccess
        // Read the dimensions BEFORE recycling, and skip the cell entirely when the write
        // failed. (The previous `runCatching{}.onFailure{ recycle; return@onFailure }` only
        // returned from the lambda, so a failed write still shipped a path to a zero-byte
        // file and recycled the bitmap twice.)
        val w = frame.width
        val h = frame.height
        frame.recycle()
        if (!wrote) {
          runCatching { file.delete() }
          continue
        }
        out.add(mapOf(
          "path" to file.absolutePath,
          "timeSec" to atMs / 1000.0,
          "width" to w,
          "height" to h,
        ))
      }
    } finally {
      runCatching { retriever.release() }
    }
    return out
  }

  /** Filmstrip frames are named for the take they came from, so they can be swept with it. */
  private const val THUMB_PREFIX = "thumb_"

  /**
   * Delete the filmstrip belonging to one take.
   *
   * Every reviewed take writes a dozen JPEGs and nothing was ever deleting them: a phone in
   * real use accumulated 192 of them alongside 14 stranded takes — 1.8 GB of cache (measured,
   * 2026-08-21). The spec asks for exactly this (§02.12).
   */
  fun deleteThumbnails(path: String): Int {
    val stem = File(path).nameWithoutExtension
    val dir = File(path).parentFile ?: return 0
    val doomed = dir.listFiles { f -> f.name.startsWith("$THUMB_PREFIX${stem}_") } ?: return 0
    return doomed.count { runCatching { it.delete() }.getOrDefault(false) }
  }

  /**
   * Sweep takes and filmstrips left behind by a crash, a kill, or an interrupted review.
   *
   * Runs at capture-screen mount. `keepNewerThanMs` protects the take currently being
   * reviewed — anything younger than the window is assumed live. Returns bytes reclaimed so
   * the caller can log a real number rather than claim success.
   */
  fun sweepOrphans(cacheDir: File, keepNewerThanMs: Long): Long {
    val cutoff = System.currentTimeMillis() - keepNewerThanMs
    val files = cacheDir.listFiles { f ->
      f.isFile && (f.name.startsWith("swing_") || f.name.startsWith(THUMB_PREFIX)) &&
        f.lastModified() < cutoff
    } ?: return 0L
    var freed = 0L
    for (f in files) {
      val size = f.length()
      if (runCatching { f.delete() }.getOrDefault(false)) freed += size
    }
    if (freed > 0) Log.i(TAG, "swept ${files.size} orphaned capture files (${freed / 1_000_000}MB)")
    return freed
  }

  // ------------------------------------------------------------------ trim

  /**
   * Remux `[startSec, endSec]` of `path` into a new file, returning its path.
   *
   * No re-encode: samples are copied, so the cut is near-instant and loses nothing. The start
   * lands on the nearest **preceding** sync frame, which is up to a keyframe interval earlier than
   * asked — that is extra lead-in, which the window wanted anyway, and never a late start that
   * would clip the takeaway.
   */
  fun trim(path: String, startSec: Double, endSec: Double): String {
    val source = File(path)
    require(source.exists()) { "no such clip: $path" }
    require(endSec > startSec) { "trim window is empty" }

    val startUs = (startSec * 1_000_000).toLong().coerceAtLeast(0L)
    val endUs = (endSec * 1_000_000).toLong()
    val out = File(source.parentFile, "trim_${System.currentTimeMillis()}_${source.name}")

    val extractor = MediaExtractor()
    var muxer: MediaMuxer? = null
    try {
      extractor.setDataSource(path)
      val muxerOut = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      muxer = muxerOut

      // Track index in the SOURCE maps to a different index in the muxer; keeping the mapping
      // explicit is what stops audio samples being written into the video track on a clip whose
      // tracks are ordered the other way round.
      val indexMap = HashMap<Int, Int>()
      var maxInputSize = 0
      for (i in 0 until extractor.trackCount) {
        val fmt = extractor.getTrackFormat(i)
        val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
        extractor.selectTrack(i)
        indexMap[i] = muxerOut.addTrack(fmt)
        if (fmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
          maxInputSize = max(maxInputSize, fmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
        }
      }
      require(indexMap.isNotEmpty()) { "clip has no video or audio track" }

      // PREVIOUS_SYNC, not CLOSEST_SYNC: a seek forward to the next keyframe would start the clip
      // AFTER the moment asked for, which on a swing means losing the takeaway.
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      muxerOut.start()

      val buffer = ByteBuffer.allocate(max(maxInputSize, 1 shl 20))
      val info = MediaCodec.BufferInfo()
      // Every track is rebased on the same origin — the first sample actually written — so the two
      // tracks stay in sync with each other rather than each starting at its own zero.
      var origin = -1L

      while (true) {
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        val time = extractor.sampleTime
        val target = indexMap[extractor.sampleTrackIndex]
        if (target != null && time <= endUs) {
          if (origin < 0) origin = time
          if (time >= origin) {
            info.offset = 0
            info.size = size
            info.presentationTimeUs = time - origin
            info.flags = extractor.sampleFlags
            muxerOut.writeSampleData(target, buffer, info)
          }
        }
        if (time > endUs) break
        extractor.advance()
      }

      muxerOut.stop()
      return out.absolutePath
    } catch (e: Throwable) {
      runCatching { out.delete() }
      throw e
    } finally {
      runCatching { muxer?.release() }
      runCatching { extractor.release() }
    }
  }
}
