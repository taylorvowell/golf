package expo.modules.frameclock

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * The measuring instrument for platform-foundation step 02, probes 1 and 2.
 *
 * Step 01 confirmed iOS has `AVPlayerItemVideoOutput` + `CADisplayLink` and could NOT confirm an
 * Android equivalent; D19 later found one, and this class is the thing that turns that finding
 * from a documentation claim into a number. `expo-video` does not surface it, which is why this
 * module exists at all rather than being a wrapper.
 *
 * The measurement is a CLOSED LOOP, and that is the whole point:
 *
 *   1. ExoPlayer tells us, on the playback thread, that frame N is about to be rendered.
 *   2. We emit that to JS, which draws its overlay and calls [markOverlayCommitted] back.
 *   3. At the instant that call arrives we compare the frame JS just drew against the frame
 *      actually on the glass, and record the difference.
 *
 * Both ends of the comparison are timed natively, so the number is not a JS self-report and
 * cannot be flattered by a slow clock or a coalesced timer. Zero means the overlay is locked to
 * the presented frame; anything else is the honest cost of the JS round-trip, which is precisely
 * what decides whether the web player's overlay architecture survives the port or whether the
 * overlay has to be drawn natively.
 */
@UnstableApi
class FrameClockView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onFrameRendered by EventDispatcher<Map<String, Any>>()
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onPlayerError by EventDispatcher<Map<String, Any>>()

  private val main = Handler(Looper.getMainLooper())

  private var player: ExoPlayer? = null
  private var videoSurface: View? = null


  /**
   * Frames per second used for every index calculation.
   *
   * Supplied by JS rather than read from the container, matching how the web player gets it from
   * `analysis.json`. Stage 0 normalizes every analysed clip to CFR, so the analyzer's notion of
   * frame N and this view's notion must come from the same number or the overlay lands on the
   * wrong frame while every individual component looks correct.
   */
  var fps: Double = 60.0

  /** Emit an event for every presented frame. Off by default — 60 events/sec is a measurement
   *  mode, not a playback mode, and leaving it on would itself perturb what we are measuring. */
  var emitFrames: Boolean = false

  /**
   * Frames that have been handed to the surface but are scheduled to appear in the FUTURE.
   *
   * This exists because of a bias that made the first real measurement unusable.
   * `onVideoFrameAboutToBeRendered` fires *before* the frame is on the glass, and `releaseTimeNs`
   * is when it will be displayed — typically ~2 frames ahead at 60fps. Scoring the overlay
   * against the most recent callback therefore compares JS against a frame the screen has not
   * shown yet, and reports drift equal to the lead time even when the overlay is perfectly
   * synced. The first run on an S25+ read p95 = 2 frames against a measured lead of ~33ms, which
   * is the same 2 frames — the bias *was* the result.
   *
   * So the schedule is kept, and "what is actually on screen" is resolved against the wall clock
   * at the moment the question is asked. Written on the playback thread, read on the main thread.
   */
  private val scheduled = ArrayDeque<Pair<Int, Long>>()
  private val scheduleLock = Any()

  /** The most recent callback, i.e. the newest frame the decoder has queued. Not on screen yet. */
  @Volatile private var queuedFrame: Int = -1

  /** Set when a seek is in flight, so the next presented frame can be scored against it. */
  @Volatile private var pendingSeekFrame: Int? = null

  private val overlayDrift = FrameStats()

  /**
   * How far AHEAD of a frame's scheduled display time JS learns about it, in ms.
   *
   * Positive is lead, and lead is good — it is the budget a JS-driven overlay has to draw in.
   * Previously this was computed as `now - releaseTimeNs`, which is lead with the sign inverted
   * and was reported as "delivery latency"; a p95 of -33ms is what exposed the deeper bias above.
   */
  private val leadTimeMs = FrameStats()
  private val seekError = FrameStats()

  /**
   * The frame actually on screen right now: the newest one whose scheduled display time has
   * already passed. Drops entries that are no longer the answer as it goes, so the deque stays
   * a couple of frames long.
   */
  private fun onScreenFrame(): Int {
    val now = System.nanoTime()
    synchronized(scheduleLock) {
      var current = -1
      while (scheduled.isNotEmpty() && scheduled.first().second <= now) {
        current = scheduled.removeFirst().first
      }
      // Put the answer back so repeated calls between frames stay consistent.
      if (current >= 0) scheduled.addFirst(current to now)
      return current
    }
  }

  init {
    // The player must exist before props arrive; source is applied when the prop lands.
    buildPlayer()
    setSurfaceType("surfaceView")
  }

  private fun buildPlayer() {
    val exo = ExoPlayer.Builder(context).build()
    // DEFAULT is already EXACT in media3 1.9.0, but state it: a future default change would
    // silently turn frame-exact seeking into nearest-sync seeking, and the failure mode is a
    // player that looks fine and is up to a GOP out.
    exo.setSeekParameters(SeekParameters.EXACT)

    exo.setVideoFrameMetadataListener { presentationTimeUs, releaseTimeNs, _, _ ->
      // Playback thread. Keep this cheap — work done here delays the frame it describes.
      val frame = frameIndexOf(presentationTimeUs, fps)
      // TIME_UNSET means "render immediately", so its display time is now, not the future.
      val displayAtNs = if (releaseTimeNs == C.TIME_UNSET) System.nanoTime() else releaseTimeNs

      queuedFrame = frame
      synchronized(scheduleLock) {
        scheduled.addLast(frame to displayAtNs)
        // A seek or a stall can strand entries whose time never arrives relative to newer ones.
        while (scheduled.size > 16) scheduled.removeFirst()
      }

      val expected = pendingSeekFrame
      if (expected != null) {
        pendingSeekFrame = null
        seekError.add((frame - expected).toDouble())
      }

      if (emitFrames) {
        main.post {
          // Positive = JS heard about the frame this many ms before it is due on screen.
          leadTimeMs.add((displayAtNs - System.nanoTime()) / 1_000_000.0)
          onFrameRendered(
            mapOf(
              "frame" to frame,
              "presentationTimeUs" to presentationTimeUs,
              "releaseTimeNs" to displayAtNs
            )
          )
        }
      }
    }

    exo.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_READY) {
          val format = exo.videoFormat
          onReady(
            mapOf(
              "durationMs" to (if (exo.duration == C.TIME_UNSET) 0L else exo.duration),
              "width" to (format?.width ?: 0),
              "height" to (format?.height ?: 0),
              // The container's own frame rate, reported alongside the fps prop precisely so a
              // mismatch is visible rather than silently absorbed into wrong frame indices.
              "containerFps" to (format?.frameRate?.toDouble() ?: 0.0)
            )
          )
        }
      }

      override fun onPlayerError(error: PlaybackException) {
        onPlayerError(mapOf("message" to (error.message ?: error.errorCodeName)))
      }
    })

    player = exo
  }

  /**
   * `surfaceView` is faster and lower-power; `textureView` composites conventionally and is the
   * documented fix for the overlapping-views z-order bug. Step 02 asks which one an
   * overlay-on-video layout actually needs, so it is switchable and measured, not assumed.
   */
  fun setSurfaceType(type: String) {
    val exo = player ?: return
    videoSurface?.let { removeView(it) }

    val surface: View = if (type == "textureView") {
      TextureView(context).also { exo.setVideoTextureView(it) }
    } else {
      SurfaceView(context).also { exo.setVideoSurfaceView(it) }
    }
    surface.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
    addView(surface, 0)
    videoSurface = surface
  }

  fun setSource(uri: String?) {
    val exo = player ?: return
    if (uri.isNullOrBlank()) {
      exo.clearMediaItems()
      return
    }
    exo.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
    exo.prepare()
  }

  fun play() {
    player?.play()
  }

  fun pause() {
    player?.pause()
  }

  /**
   * Seek to the middle of [frame]'s display interval and score what actually arrives.
   *
   * The result is not returned here — it is recorded when the next frame is presented, because
   * the only trustworthy answer to "did the seek land on the right frame" is the timestamp of the
   * frame that subsequently reached the screen. Asking the player where it thinks it is would
   * measure the player's bookkeeping, not the picture.
   */
  fun seekToFrame(frame: Int) {
    val exo = player ?: return
    pendingSeekFrame = frame
    exo.seekTo(seekTargetMs(frame, fps))
  }

  /**
   * JS calls this immediately after committing an overlay for [frame].
   *
   * Drift is measured against the frame on the glass at the moment the call arrives, so it counts
   * whole frames of lateness in the JS round-trip. A negative value would mean JS drew ahead of
   * the decoder, which only happens if [fps] disagrees with the media.
   */
  fun markOverlayCommitted(frame: Int) {
    // Against what is ON SCREEN, not what has merely been queued. Comparing against the queued
    // frame inflates drift by the callback's lead time, which is what made the first S25+ run
    // read p95 = 2 frames when the lead was ~2 frames.
    val current = onScreenFrame()
    if (current < 0) return
    overlayDrift.add((current - frame).toDouble())
  }

  fun resetStats() {
    overlayDrift.reset()
    leadTimeMs.reset()
    seekError.reset()
    synchronized(scheduleLock) { scheduled.clear() }
  }

  fun stats(): Map<String, Any> = mapOf(
    "overlayDriftFrames" to overlayDrift.toMap(),
    "leadTimeMs" to leadTimeMs.toMap(),
    "seekErrorFrames" to seekError.toMap(),
    "onScreenFrame" to onScreenFrame(),
    "queuedFrame" to queuedFrame,
    "fps" to fps
  )

  fun release() {
    player?.release()
    player = null
  }
}
