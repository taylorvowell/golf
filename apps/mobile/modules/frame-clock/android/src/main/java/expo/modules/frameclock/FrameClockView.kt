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

  @Volatile private var presentedFrame: Int = -1
  @Volatile private var presentedAtNs: Long = 0L

  /** Set when a seek is in flight, so the next presented frame can be scored against it. */
  @Volatile private var pendingSeekFrame: Int? = null

  private val overlayDrift = FrameStats()
  private val deliveryLatencyMs = FrameStats()
  private val seekError = FrameStats()

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
      presentedFrame = frame
      presentedAtNs = if (releaseTimeNs == C.TIME_UNSET) System.nanoTime() else releaseTimeNs

      val expected = pendingSeekFrame
      if (expected != null) {
        pendingSeekFrame = null
        seekError.add((frame - expected).toDouble())
      }

      if (emitFrames) {
        val renderedAtNs = presentedAtNs
        main.post {
          deliveryLatencyMs.add((System.nanoTime() - renderedAtNs) / 1_000_000.0)
          onFrameRendered(
            mapOf(
              "frame" to frame,
              "presentationTimeUs" to presentationTimeUs,
              "releaseTimeNs" to renderedAtNs
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
    val current = presentedFrame
    if (current < 0) return
    overlayDrift.add((current - frame).toDouble())
  }

  fun resetStats() {
    overlayDrift.reset()
    deliveryLatencyMs.reset()
    seekError.reset()
  }

  fun stats(): Map<String, Any> = mapOf(
    "overlayDriftFrames" to overlayDrift.toMap(),
    "eventDeliveryMs" to deliveryLatencyMs.toMap(),
    "seekErrorFrames" to seekError.toMap(),
    "presentedFrame" to presentedFrame,
    "fps" to fps
  )

  fun release() {
    player?.release()
    player = null
  }
}
