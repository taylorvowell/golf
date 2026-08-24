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
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

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

  /**
   * How much of each end of a clip is a priori unlikely to hold the strike (Taylor, 2026-08-21).
   *
   * A golfer filming alone starts the recording, walks out to the ball, hits, and walks back to
   * stop it — so both ends are footsteps, phone handling and setup noise, which is exactly the
   * material that fools a loudness detector. The first and last five seconds are therefore
   * DOWN-WEIGHTED, never excluded: a swing taken right beside the phone is unlikely, not
   * impossible, and a hard cut would make the seed provably wrong in a case that does happen.
   */
  private const val EDGE_SEC = 5.0

  /**
   * What an edge candidate's score is multiplied by at the very first/last sample.
   *
   * Non-zero on purpose — this is a prior, not a filter. A genuine strike in the first second
   * still wins if nothing in the interior comes close to it, which is the behaviour "unlikely"
   * describes and "impossible" does not.
   */
  private const val EDGE_FLOOR = 0.15

  /**
   * A short clip has no uninteresting ends to discount, so the edge window shrinks with it.
   *
   * Without this a six-second clip would be entirely edge and every candidate would be scaled
   * by roughly the same weight — arithmetic with no effect, spent on every window.
   */
  private const val EDGE_MAX_FRACTION = 0.25

  data class Impact(val timeSec: Double, val score: Double)

  /**
   * The three short-time views of the audio, all built in one decode pass.
   *
   * Kept together because every method reads some combination of them, and decoding a
   * 60-second clip once per method — eight times, to compare eight — is the difference between
   * a drawer worth switching in and one nobody waits for.
   */
  private class Envelopes(
    val peak: DoubleArray,
    val hf: DoubleArray,
    val rms: DoubleArray,
    /**
     * RMS per window of the signal above [HIGH_BAND_HZ] - the real high-frequency view.
     *
     * [Method.HF] approximates this with `|x[n] - x[n-1]|`, whose gain rises linearly with
     * frequency and therefore never stops responding to loudness: a dull thump twenty times
     * louder than a click still wins. A filter with an actual corner does not leak that way, and
     * this is the envelope every measurement in `checkaudio.py` was made on.
     */
    val band: DoubleArray,
  ) {
    companion object {
      val EMPTY = Envelopes(DoubleArray(0), DoubleArray(0), DoubleArray(0), DoubleArray(0))
    }
  }

  /**
   * Where a strike lives and a voice, a gust and a footstep do not.
   *
   * A club-ball contact is a broadband click with real energy well past 4 kHz. Speech has rolled
   * off by there, wind is near-DC and a footstep is a low thud. Chosen from the physics of the
   * sources, not tuned against a clip.
   */
  private const val HIGH_BAND_HZ = 4000.0

  /**
   * How finely the background floor is sampled, in seconds, and how wide a neighbourhood of
   * blocks it is taken over.
   *
   * Half a second is a hundred 5 ms windows - far more than any transient occupies, so a strike
   * cannot drag its own block's median upwards. That is the whole point of using a median.
   */
  private const val BACKGROUND_BLOCK_S = 0.5
  private const val BACKGROUND_SPAN_S = 2.0

  /**
   * How long before contact a club is audibly moving, and the gap left before contact itself.
   *
   * A club head accelerating towards 100 mph is a broadband hiss that climbs for roughly this
   * long and stops dead at the ball. Measured on the five long takes in `fixtures/raw`, the ramp
   * is readable from about 200 ms out and is over about 30 ms before the click.
   */
  private const val SWISH_LOOKBACK_S = 0.20
  private const val SWISH_GUARD_S = 0.03

  /**
   * The most credit a swing-up can earn, and how steeply it is counted.
   *
   * Uncapped the term does the opposite of its job: a WEAK click inside continuous noise - a
   * golfer walking back with the club swinging at their side - measures an enormous ramp against
   * its own local median and beats a strike thirty times louder. On 6iron-1 the walk back scored
   * 9.9 where the strike scored 1.8. A ramp is evidence a club swung; a bigger ramp is not more
   * evidence, it is a noisier background.
   *
   * Cubed because the raw separation is only about 1.7x while the impostors it has to beat are
   * up to 2.2x LOUDER - a linear weight does not turn the ranking over.
   */
  private const val SWISH_CAP = 2.5
  private const val SWISH_POWER = 3.0

  /**
   * A direct-form-1 biquad, carried across the whole track.
   *
   * Five multiplies a sample and no buffering, which is what lets the high band be measured
   * inside the decode loop that already exists rather than in a second pass over a spectrum.
   */
  private class Biquad(
    private val b0: Double,
    private val b1: Double,
    private val b2: Double,
    private val a1: Double,
    private val a2: Double,
  ) {
    private var x1 = 0.0
    private var x2 = 0.0
    private var y1 = 0.0
    private var y2 = 0.0

    fun step(x: Double): Double {
      val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = x; y2 = y1; y1 = y
      return y
    }

    companion object {
      /** 2nd-order Butterworth (Q = 1/sqrt2). The RBJ cookbook high-pass, coefficients inline. */
      fun highPass(sampleRate: Double, cutoff: Double): Biquad {
        val w0 = 2.0 * Math.PI * cutoff / sampleRate
        val cos0 = cos(w0)
        val alpha = sin(w0) / (2.0 * sqrt(0.5))
        val a0 = 1.0 + alpha
        return Biquad(
          (1.0 + cos0) / 2.0 / a0,
          -(1.0 + cos0) / a0,
          (1.0 + cos0) / 2.0 / a0,
          (-2.0 * cos0) / a0,
          (1.0 - alpha) / a0,
        )
      }
    }
  }

  /**
   * How a strike is picked out of the audio. Eight genuinely different discriminators, not eight
   * tunings of one — the point of switching is to find out which PHYSICAL property
   * of a golf strike separates it best from a range's other loud events.
   *
   * There is no ground truth for any of them yet. Whichever wins, wins on a developer watching
   * the seed land against 29 real clips; that is a preference, not a measurement, and it must
   * not be written down as accuracy (the project has made that mistake before).
   */
  enum class Method {
    /** Ratio to background AND rise against the previous window. The shipped default. */
    ATTACK,

    /** Plain loudest window. The naive baseline — worth having precisely because it is what
     * everyone assumes works, and seeing it fail on a shout is the argument for the others. */
    PEAK,

    /**
     * Rise in HIGH-FREQUENCY content, from a first-difference (crude high-pass) envelope.
     *
     * Physically well motivated: a club striking a ball is a broadband click
     * with strong energy well above anything a voice, a gust or a footstep produces, so this
     * should reject the loud-but-dull events that fool loudness.
     */
    HF,

    /**
     * Onset strength — positive change in energy between windows, the classic onset detector.
     *
     * Scores the EDGE rather than the level, so a strike arriving on top of an already-noisy
     * background still stands out, where a ratio-to-background test would be swamped.
     */
    FLUX,

    /**
     * ATTACK's background-and-rise test, run on the high-frequency envelope instead of the raw
     * one — the two ideas that work best, composed.
     *
     * HF alone still fires on anything with a sharp edge; ATTACK alone still fires on anything
     * loud and sudden. Requiring a sharp edge that is ALSO sharp *in the treble* is the closest
     * cheap description of a golf strike this file has.
     */
    SHARP,

    /**
     * Crest factor — the window's peak divided by its own RMS.
     *
     * Measures IMPULSIVENESS independently of loudness: a click is a large spike sitting in an
     * otherwise quiet window, so its peak dwarfs its average, while a shout or a gust fills the
     * whole window and has a crest near one. The only method here that is scale-free, so it does
     * not care how far away the phone was.
     */
    CREST,

    /**
     * Impulse shape — a fast rise IMMEDIATELY followed by a fast fall.
     *
     * The one test that uses what happens AFTER the candidate. A ball strike is over in
     * milliseconds; a voice, a gust, a passing car and a bag hitting the ground all sustain. Two
     * windows of decay is what separates them, and nothing that only looks backwards can see it.
     */
    DECAY,

    /**
     * A high-frequency click with a club audibly swinging in front of it. **The shipped method.**
     *
     * Every other method here describes the TRANSIENT, which is why they all lose to a louder
     * transient - and on a real take the louder transient routinely is not the swing. A ball
     * dropped on the mat, a club tapped on the floor, the knock of a thumb on the phone as Record
     * is pressed and a shot from the next bay are all clicks with SILENCE in front of them. A
     * golf strike is the only one with two hundred milliseconds of club noise leading into it.
     *
     * Measured over the five long takes in `fixtures/raw` against hand-labelled strike frames
     * (`services/analyzer/scripts/audio_truth.json`, via `checkaudio.py --truth`): 5/5 inside
     * 250 ms, median error 0 ms, worst 10 ms, and unchanged with the edge prior switched off.
     * Every other method scored 3/5 or worse on the same clips.
     *
     * **Those five clips are one golfer, indoors, in one simulator bay.** They are the first
     * ground truth this project has and they are not a generalisation: nothing here has been run
     * against an outdoor take, a left-hander, or a second device.
     */
    SWISH,

    /**
     * Agreement across every other method - the candidate the most detectors independently like.
     *
     * Each method's candidates are normalised against its own best (their scores are on wildly
     * different scales) and votes are summed over candidates that land within one separation
     * window of each other. Costs nothing extra: all methods read the same single decode.
     */
    ENSEMBLE;

    companion object {
      /** Unknown names fall back rather than throwing — a stale JS build must not break Save. */
      fun parse(raw: String?): Method =
        entries.firstOrNull { it.name.equals(raw ?: "", ignoreCase = true) } ?: ATTACK
    }
  }

  // ------------------------------------------------------------------ detection

  /**
   * Candidate strike times in the clip, strongest-scoring first, at most `limit`.
   *
   * Empty is a normal answer — an indoor mat, a muted take, a windy range — and the caller is
   * expected to fall back to a default window rather than treat it as an error.
   */
  fun detectImpacts(
    path: String,
    limit: Int = 3,
    method: Method = Method.ATTACK,
    edgeWeighting: Boolean = true,
  ): List<Impact> {
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
      // One decode serves every method — all three envelopes are built in the same pass, so
      // switching method costs nothing extra and the ensemble is one decode, not eight.
      val env = decodeEnvelope(extractor, format, sampleRate, channels)
      val windowSec = WINDOW_MS / 1000.0
      val durationSec = env.peak.size * windowSec
      separate(weightByTime(score(method, env, windowSec), durationSec, edgeWeighting), limit)
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
  ): Envelopes {
    val mime = format.getString(MediaFormat.KEY_MIME) ?: return Envelopes.EMPTY
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
    /** The same windows measured on |x[n] − x[n−1]| — a one-tap high-pass, so it responds to
     *  how FAST the waveform moves rather than how far, which is what a click is. */
    val hfOut = ArrayList<Double>(4096)
    /** Root-mean-square per window. Only CREST reads it, and only as the denominator that
     *  turns a peak into "how spiky", which is the one scale-free thing here. */
    val rmsOut = ArrayList<Double>(4096)
    /** RMS per window of the high-passed signal - the envelope SWISH is built on. */
    val bandOut = ArrayList<Double>(4096)
    val highBand = Biquad.highPass(sampleRate.toDouble(), HIGH_BAND_HZ)
    var windowPeak = 0.0
    var windowHf = 0.0
    var windowSquares = 0.0
    var windowBandSquares = 0.0
    var previousSample = 0.0
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
              val sample = frameMax / 32768.0
              windowPeak = max(windowPeak, sample)
              windowHf = max(windowHf, abs(sample - previousSample))
              windowSquares += sample * sample
              // The filter runs ACROSS window boundaries, never within them - its state is the
              // signal's recent history, and resetting it per window would plant a step response
              // at the start of every one.
              val high = highBand.step(sample)
              windowBandSquares += high * high
              previousSample = sample
              if (++windowCount >= samplesPerWindow) {
                out.add(windowPeak)
                hfOut.add(windowHf)
                rmsOut.add(sqrt(windowSquares / windowCount))
                bandOut.add(sqrt(windowBandSquares / windowCount))
                windowPeak = 0.0
                windowHf = 0.0
                windowSquares = 0.0
                windowBandSquares = 0.0
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

    if (windowCount > 0) {
      out.add(windowPeak)
      hfOut.add(windowHf)
      rmsOut.add(sqrt(windowSquares / windowCount))
      bandOut.add(sqrt(windowBandSquares / windowCount))
    }
    return Envelopes(
      out.toDoubleArray(),
      hfOut.toDoubleArray(),
      rmsOut.toDoubleArray(),
      bandOut.toDoubleArray(),
    )
  }

  /**
   * Windows that rise sharply out of their own background.
   *
   * Two tests, and the second is the one doing the work. **Ratio to background** keeps the list
   * short. **Attack** — this window against the one before it — is what distinguishes a strike from
   * every other loud thing at a driving range: a shout, a gust and a dropped bag are all loud and
   * none of them arrive in 5 milliseconds.
   */
  private fun byAttack(env: DoubleArray, windowSec: Double): List<Impact> {
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

    return found
  }

  /** Route a method to its raw scored candidates. Separation and the time prior come after. */
  private fun score(method: Method, env: Envelopes, windowSec: Double): List<Impact> =
    when (method) {
      Method.ATTACK -> byAttack(env.peak, windowSec)
      Method.HF -> byAttack(env.hf, windowSec)
      Method.SHARP -> bySharp(env, windowSec)
      Method.SWISH -> bySwish(env, windowSec)
      Method.PEAK -> byLevel(env.peak, windowSec)
      Method.FLUX -> byFlux(env.peak, windowSec)
      Method.CREST -> byCrest(env, windowSec)
      Method.DECAY -> byDecay(env.peak, windowSec)
      Method.ENSEMBLE -> byEnsemble(env, windowSec)
    }

  /**
   * The loudest windows, full stop.
   *
   * The naive baseline, kept because it is what everyone assumes a strike detector is, and
   * because watching it seed on a shout or a passing car is the clearest possible argument for
   * the others. No background model and no attack test.
   */
  private fun byLevel(env: DoubleArray, windowSec: Double): List<Impact> =
    env.indices.map { Impact(it * windowSec, env[it]) }

  /**
   * Positive change in level between windows — the classic onset detector.
   *
   * Scores the EDGE, not the level. Where ATTACK asks "is this loud relative to the quiet
   * background", flux asks only "did it just get louder", which keeps working when the
   * background is not quiet — a range with a mower running, a windy day.
   */
  private fun byFlux(env: DoubleArray, windowSec: Double): List<Impact> =
    (1 until env.size).map { Impact(it * windowSec, max(0.0, env[it] - env[it - 1])) }

  /**
   * Peak over RMS within the window — impulsiveness measured without loudness.
   *
   * Scale-free, which is the property nothing else here has: it does not care how far the phone
   * was from the ball, only whether the window is one spike in near-silence or a wall of sound.
   * Gated on audibility, because the ratio between two inaudible numbers can be enormous and
   * means nothing.
   */
  private fun byCrest(env: Envelopes, windowSec: Double): List<Impact> {
    val n = min(env.peak.size, env.rms.size)
    val audible = (env.peak.maxOrNull() ?: 0.0) * 0.05
    return (0 until n).mapNotNull { i ->
      if (env.peak[i] < audible) null
      else Impact(i * windowSec, env.peak[i] / max(env.rms[i], 1e-5))
    }
  }

  /**
   * A sharp rise followed immediately by a sharp fall.
   *
   * The only test here that looks FORWARD. A strike is over in milliseconds while a shout, a
   * gust, a car and a dropped bag all sustain, so the fall is a discriminator none of the
   * backwards-looking methods can see. Rise times fall, so both must hold.
   */
  private fun byDecay(env: DoubleArray, windowSec: Double): List<Impact> {
    if (env.size < 4) return emptyList()
    return (1 until env.size - 2).map { i ->
      val rise = env[i] - env[i - 1]
      // Two windows out, not one: a strike's own ring-down occupies the window right after it.
      val fall = env[i] - env[i + 2]
      Impact(i * windowSec, if (rise > 0 && fall > 0) rise * fall else 0.0)
    }
  }

  /**
   * ATTACK on the HF envelope, weighted by absolute level.
   *
   * The composition of the two ideas that each work half the time. The level term is why it is
   * not just HF: sharpness alone picks a fabric rustle against the microphone, which is all
   * treble and nothing like a ball being struck.
   */
  private fun bySharp(env: Envelopes, windowSec: Double): List<Impact> {
    val n = min(env.hf.size, env.peak.size)
    if (n < 4) return emptyList()
    return byAttack(env.hf.copyOf(n), windowSec).map { cand ->
      val i = (cand.timeSec / windowSec).toInt().coerceIn(0, n - 1)
      Impact(cand.timeSec, cand.score * env.peak[i])
    }
  }

  /**
   * A robust noise floor: the median of half-second blocks, smoothed over their neighbours.
   *
   * [byAttack] instead seeds an EMA from the file's first two hundred milliseconds - which is the
   * instant a thumb came off the Record button. A handling knock there raises the bar for the
   * whole clip and the real strike never clears [PEAK_RATIO] afterwards. A median is indifferent
   * to the very spikes it is being used to measure against, which is the property the EMA has to
   * be hand-guarded into faking (`if (ratio < PEAK_RATIO)`).
   *
   * Two cheap passes rather than a sort per window: block medians first, then a median over the
   * blocks within [BACKGROUND_SPAN_S].
   */
  private fun rollingBackground(env: DoubleArray, windowSec: Double): DoubleArray {
    if (env.isEmpty()) return env
    val block = max(1, (BACKGROUND_BLOCK_S / windowSec).toInt())
    val blocks = (env.size + block - 1) / block
    val perBlock = DoubleArray(blocks) { b ->
      val from = b * block
      val to = min(from + block, env.size)
      env.copyOfRange(from, to).sortedArray().let { it[it.size / 2] }
    }
    val reach = max(1, ((BACKGROUND_SPAN_S / BACKGROUND_BLOCK_S) / 2).toInt())
    val smoothed = DoubleArray(blocks) { b ->
      val from = max(0, b - reach)
      val to = min(blocks, b + reach + 1)
      perBlock.copyOfRange(from, to).sortedArray().let { it[it.size / 2] }
    }
    return DoubleArray(env.size) { i -> max(smoothed[min(i / block, blocks - 1)], 1e-6) }
  }

  /**
   * How much air the club was moving in the two hundred milliseconds before this instant.
   *
   * **The one term that asks whether a GOLFER SWUNG, rather than whether something made a
   * noise.** Everything else in this file describes the transient, so everything else loses to a
   * louder transient. Capped - see [SWISH_CAP].
   */
  private fun swishGain(band: DoubleArray, floor: DoubleArray, i: Int, windowSec: Double): Double {
    val lo = max(0, i - (SWISH_LOOKBACK_S / windowSec).toInt())
    val hi = max(lo + 1, i - (SWISH_GUARD_S / windowSec).toInt())
    if (hi > band.size) return 0.0
    var sum = 0.0
    for (k in lo until hi) sum += band[k]
    return min((sum / (hi - lo)) / floor[i], SWISH_CAP)
  }

  /**
   * A high-band click with a club swing audibly leading into it. See [Method.SWISH].
   */
  private fun bySwish(env: Envelopes, windowSec: Double): List<Impact> {
    val band = env.band
    if (band.size < 8) return emptyList()
    val floor = rollingBackground(band, windowSec)
    val found = ArrayList<Impact>()
    for (i in 1 until band.size) {
      val ratio = band[i] / floor[i]
      val attack = band[i] / max(band[i - 1], 1e-6)
      if (ratio <= PEAK_RATIO || attack <= 2.0) continue
      val gain = swishGain(band, floor, i, windowSec).pow(SWISH_POWER)
      found.add(Impact(i * windowSec, ratio * attack * gain))
    }
    return found
  }

  /**
   * What the other methods agree on.
   *
   * Every method runs, each one's candidates are normalised against its OWN best — the scores
   * are on incomparable scales, a crest factor and an amplitude product sharing no units — and
   * candidates within one separation window pool their votes. A time four detectors
   * independently like beats a time one likes enormously, which is the whole point: their
   * failure modes differ, so agreement is evidence where magnitude is not.
   */
  private fun byEnsemble(env: Envelopes, windowSec: Double): List<Impact> {
    val votes = ArrayList<Impact>()
    for (method in Method.entries) {
      if (method == Method.ENSEMBLE) continue
      // Only each method's few best vote. The full candidate list is mostly noise, and letting
      // all of it vote would simply re-derive the loudest window.
      val top = separate(score(method, env, windowSec), 3)
      val best = top.maxOfOrNull { it.score } ?: continue
      if (best <= 0.0) continue
      for (cand in top) votes.add(Impact(cand.timeSec, cand.score / best))
    }
    if (votes.isEmpty()) return emptyList()

    // Pooled to their weighted centre, so agreement SHARPENS the estimate rather than just
    // confirming whichever method happened to be listed first.
    val pooled = ArrayList<Impact>()
    for (vote in votes.sortedBy { it.timeSec }) {
      val last = pooled.lastOrNull()
      if (last != null && abs(last.timeSec - vote.timeSec) < MIN_SEPARATION_S) {
        val total = last.score + vote.score
        pooled[pooled.size - 1] =
          Impact((last.timeSec * last.score + vote.timeSec * vote.score) / total, total)
      } else {
        pooled.add(vote)
      }
    }
    return pooled
  }

  /**
   * Down-weight candidates near either end of the clip — Taylor's prior, 2026-08-21.
   *
   * A clip filmed alone begins with a walk out and ends with a walk back, so both ends carry
   * footsteps, phone handling and setup noise: the loud, sharp, non-golf material every method
   * here is vulnerable to. The weight ramps from `EDGE_FLOOR` at the very edge to 1 at
   * `EDGE_SEC` in, so an edge candidate must be several times stronger than an interior one to
   * still win — unlikely, not impossible, which is the instruction.
   *
   * Switchable off, because a prior nobody can turn off is a prior nobody can check.
   */
  private fun weightByTime(
    candidates: List<Impact>,
    durationSec: Double,
    enabled: Boolean,
  ): List<Impact> {
    if (!enabled || durationSec <= 0) return candidates
    val edge = min(EDGE_SEC, durationSec * EDGE_MAX_FRACTION)
    if (edge <= 0) return candidates
    return candidates.map { cand ->
      val nearest = min(cand.timeSec, durationSec - cand.timeSec)
      if (nearest >= edge) {
        cand
      } else {
        val ramp = (nearest / edge).coerceIn(0.0, 1.0)
        Impact(cand.timeSec, cand.score * (EDGE_FLOOR + (1 - EDGE_FLOOR) * ramp))
      }
    }
  }

  /**
   * Strongest first, dropping anything within `MIN_SEPARATION_S` of a stronger pick.
   *
   * Every method needs this and for the same reason: a strike and its echo off the bay wall are
   * one event, and returning both spends a candidate slot on a duplicate.
   */
  private fun separate(scored: List<Impact>, limit: Int): List<Impact> {
    val merged = ArrayList<Impact>()
    for (cand in scored.sortedByDescending { it.score }) {
      if (cand.score <= 0.0) break
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
  /**
   * Frames at EXPLICIT times — the filmstrip for a scrubber whose time axis is not linear.
   *
   * Evenly spaced frames describe an evenly spaced axis. Once the track spends most of its width
   * on the seconds around impact, an even strip stops matching what is under the finger, and the
   * picture at a cell is no longer the moment that cell selects.
   */
  fun thumbnailsAt(path: String, timesSec: List<Double>, width: Int, outDir: File): List<Map<String, Any>> {
    val source = File(path)
    require(source.exists()) { "no such clip: $path" }
    if (timesSec.isEmpty()) return emptyList()

    val retriever = MediaMetadataRetriever()
    val out = mutableListOf<Map<String, Any>>()
    try {
      retriever.setDataSource(source.absolutePath)
      val stem = source.nameWithoutExtension
      timesSec.forEachIndexed { i, atSec ->
        val frame = runCatching {
          retriever.getScaledFrameAtTime(
            (atSec * 1_000_000L).toLong().coerceAtLeast(0L),
            MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
            width,
            width,
          )
        }.getOrNull() ?: return@forEachIndexed

        val file = File(outDir, "$THUMB_PREFIX${stem}_$i.jpg")
        val wrote = runCatching {
          FileOutputStream(file).use { frame.compress(Bitmap.CompressFormat.JPEG, 70, it) }
        }.isSuccess
        val w = frame.width
        val h = frame.height
        frame.recycle()
        if (!wrote) {
          runCatching { file.delete() }
          return@forEachIndexed
        }
        out.add(mapOf(
          "path" to file.absolutePath,
          "timeSec" to atSec,
          "width" to w,
          "height" to h,
        ))
      }
    } finally {
      runCatching { retriever.release() }
    }
    return out
  }

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
  /** What the dev clip drawer will offer. Anything else in the folder is ignored silently. */
  private val VIDEO_EXTENSIONS = setOf("mp4", "mov", "m4v")

  /**
   * Pre-recorded clips a developer dropped in, newest first — the take a real recording would
   * have produced, without standing on a range.
   *
   * A missing folder is a normal answer (`emptyList`), not an error: the drawer says how to
   * fill it. An unreadable file is skipped rather than failing the whole listing, because one
   * half-copied `adb push` should not hide the other twenty clips.
   */
  fun listDevClips(dir: File): List<Map<String, Any>> =
    dir.takeIf { it.isDirectory }
      ?.listFiles { f: File -> f.isFile && f.extension.lowercase() in VIDEO_EXTENSIONS }
      ?.sortedByDescending { it.lastModified() }
      ?.mapNotNull { describe(it) }
      ?: emptyList()

  /**
   * A clip's real duration and frame rate, or null when it cannot be read.
   *
   * The rate is derived as **frames ÷ duration**, not taken from a metadata field, because the
   * two disagree exactly where it matters. A phone's slow-motion mode writes a file that was
   * CAPTURED at 240 and PLAYS at 30, and the frame clock needs the rate the container actually
   * advances at — `CAPTURE_FRAMERATE` would put every scrub eight frames out. The track's own
   * `frame-rate` is the fallback for pre-28 devices, which publish no frame count.
   */
  private fun describe(file: File): Map<String, Any>? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      val durationMs = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: return null
      if (durationMs <= 0L) return null
      val frames = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull()
      val fps = when {
        frames != null && frames > 0 -> frames * 1000.0 / durationMs
        else -> trackFrameRate(file.absolutePath) ?: return null
      }
      // The rate the SENSOR ran at, which for a phone slow-motion clip is not the rate the file
      // plays at: `com.android.capture.fps=240` on a container that advances at 30 means the
      // timeline runs 8x slower than reality. Absent on an ordinary recording, and 0 there.
      val captureFps = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)?.toDoubleOrNull()
      mapOf(
        "path" to file.absolutePath,
        "name" to file.name,
        "durationMs" to durationMs.toDouble(),
        "fps" to fps,
        "captureFps" to (captureFps ?: 0.0),
        "sizeBytes" to file.length().toDouble(),
      )
    } catch (_: Throwable) {
      null
    } finally {
      runCatching { retriever.release() }
    }
  }

  private fun trackFrameRate(path: String): Double? {
    val extractor = MediaExtractor()
    return try {
      extractor.setDataSource(path)
      (0 until extractor.trackCount)
        .map { extractor.getTrackFormat(it) }
        .firstOrNull { it.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
        ?.takeIf { it.containsKey(MediaFormat.KEY_FRAME_RATE) }
        ?.getInteger(MediaFormat.KEY_FRAME_RATE)
        ?.toDouble()
    } catch (_: Throwable) {
      null
    } finally {
      runCatching { extractor.release() }
    }
  }

  /**
   * The rotation an MP4 declares, or null when it declares none.
   *
   * Null is a real answer, not a failure: takes recorded before the recorder started stamping
   * a hint (2026-08-21) genuinely carry nothing, and inventing 90 for them would rotate a file
   * that was already being drawn the way it was written.
   */
  private fun rotationOf(path: String): Int? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(path)
      retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
        ?.toIntOrNull()
        ?.takeIf { it != 0 }
    } catch (_: Throwable) {
      null
    } finally {
      runCatching { retriever.release() }
    }
  }

  fun trim(path: String, startSec: Double, endSec: Double, outDir: File): String {
    val source = File(path)
    require(source.exists()) { "no such clip: $path" }
    require(endSec > startSec) { "trim window is empty" }

    val startUs = (startSec * 1_000_000).toLong().coerceAtLeast(0L)
    val endUs = (endSec * 1_000_000).toLong()
    // Always the cache, never beside the source. For a real take those are the same folder; for
    // a dev clip they are not, and writing there would litter the developer's own library with
    // trims — and put them where the cache sweep can never reach them.
    val out = File(outDir, "trim_${System.currentTimeMillis()}_${source.name}")

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

      // A remux starts from a blank header, so the source's rotation is NOT inherited — carry
      // it across explicitly or Save turns an upright take back onto its side. Read off the
      // source rather than recomputed from the camera: the trim has no idea which lens shot it.
      rotationOf(source.absolutePath)?.let { muxerOut.setOrientationHint(it) }

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
