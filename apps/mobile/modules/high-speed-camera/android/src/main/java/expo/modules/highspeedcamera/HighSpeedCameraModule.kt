package expo.modules.highspeedcamera

import android.content.Context
import android.media.AudioManager
import android.media.MediaActionSound
import android.media.ToneGenerator
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * True high-frame-rate capture. **1080p at 231fps measured on a Galaxy S25+** (D39).
 *
 * ## The road not taken, so it is not re-walked
 *
 * `react-native-vision-camera` v5 accepted a 120/240 request and silently delivered 60 (D37).
 * CameraX 1.5's high-speed API refused outright, because it gates on `CamcorderProfile` and this
 * device publishes no high-speed profile — while Camera2's own configuration map advertises 1080p
 * at both 120 and 240 (D38). The CameraX path was implemented, measured, and removed; only
 * `Camera2HighSpeed` remains.
 *
 * ## The one line that decides whether this works at all
 *
 * `createConstrainedHighSpeedCaptureSession(surfaces, callback, handler)` — the DEPRECATED
 * overload. The modern `createCaptureSession(SessionConfiguration(SESSION_HIGH_SPEED, …))` is
 * *swallowed* on this device: the camera opens and then neither `onConfigured` nor
 * `onConfigureFailed` ever fires. Silence, not refusal. "Fixing" the deprecation removes 240fps
 * capture and leaves no error to explain it.
 */
class HighSpeedCameraModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  /** The system camera's own record start/stop cues — loaded on first use, released with the
   * module. No bundled assets: golfers hear exactly what their stock camera app plays. */
  private var actionSound: MediaActionSound? = null

  /** The countdown's 3-2-1 tick — a quiet system tone, deliberately softer than the record cue. */
  private var toneGenerator: ToneGenerator? = null

  override fun definition() = ModuleDefinition {
    Name("HighSpeedCamera")

    AsyncFunction("playRecordSound") { start: Boolean ->
      val sound = actionSound ?: MediaActionSound().also {
        it.load(MediaActionSound.START_VIDEO_RECORDING)
        it.load(MediaActionSound.STOP_VIDEO_RECORDING)
        actionSound = it
      }
      sound.play(
        if (start) MediaActionSound.START_VIDEO_RECORDING
        else MediaActionSound.STOP_VIDEO_RECORDING,
      )
    }

    AsyncFunction("playCountdownTick") {
      val tg = toneGenerator
        ?: ToneGenerator(AudioManager.STREAM_MUSIC, TICK_VOLUME).also { toneGenerator = it }
      tg.startTone(ToneGenerator.TONE_PROP_BEEP, TICK_MS)
    }

    /** The press acknowledgment — a quick two-tone ACK, distinct from the countdown's beep. */
    AsyncFunction("playClickSound") {
      val tg = toneGenerator
        ?: ToneGenerator(AudioManager.STREAM_MUSIC, TICK_VOLUME).also { toneGenerator = it }
      tg.startTone(ToneGenerator.TONE_PROP_ACK, TICK_MS)
    }

    OnDestroy {
      actionSound?.release()
      actionSound = null
      toneGenerator?.release()
      toneGenerator = null
    }

    /** The live capture surface (D61 step 04) — preview props, and the take itself. */
    View(HighSpeedCameraView::class) {
      // onZoomRange: the lens's real range, so the UI never renders a slider against a guess.
      // onRecordingEnded: the hard cap elapsing or the camera failing mid-take — endings JS did
      // not ask for and cannot poll for.
      Events("onZoomRange", "onRecordingEnded")
      Prop("facing") { view: HighSpeedCameraView, facing: String -> view.setFacing(facing) }
      Prop("zoom") { view: HighSpeedCameraView, zoom: Double -> view.setZoom(zoom.toFloat()) }

      /**
       * Start a take at the highest rate at or below `maxFps` this lens actually offers.
       *
       * Resolves with the rate the session was CONFIGURED at, never the rate asked for — §2.3
       * forbids degrading silently, so the pill shows 231 when the device gives 231.
       */
      AsyncFunction("startRecording") { view: HighSpeedCameraView, maxFps: Int, maxSeconds: Int, promise: Promise ->
        view.startRecording(maxFps, maxSeconds) { result ->
          result.fold(
            onSuccess = { promise.resolve(it) },
            onFailure = { promise.reject("RECORD_START", it.message ?: "could not start recording", null) },
          )
        }
      }

      /** End the take by tap. The cap ends it through `onRecordingEnded` instead. */
      AsyncFunction("stopRecording") { view: HighSpeedCameraView, promise: Promise ->
        view.stopRecording { result ->
          result.fold(
            onSuccess = { promise.resolve(it) },
            onFailure = { promise.reject("RECORD_STOP", it.message ?: "could not stop recording", null) },
          )
        }
      }
    }

    /**
     * Candidate strike times in a recorded take, strongest first — the review window's seed.
     *
     * An empty list is a normal answer (indoor mat, wind, a muted take), not an error: the caller
     * falls back to a default window and the golfer slides it. Nothing here is a measurement — the
     * real Impact frame comes from the analyzer, which snaps it to the club-head low point.
     */
    AsyncFunction("detectImpacts") { path: String, limit: Int, promise: Promise ->
      try {
        promise.resolve(SwingClip.detectImpacts(path, limit).map {
          mapOf("timeSec" to it.timeSec, "score" to it.score)
        })
      } catch (e: Throwable) {
        promise.reject("DETECT_IMPACTS", e.message ?: "impact detection failed", e)
      }
    }

    /** Remux a window out of a take — no re-encode, so it costs milliseconds and loses nothing. */
    AsyncFunction("trimClip") { path: String, startSec: Double, endSec: Double, promise: Promise ->
      try {
        promise.resolve(mapOf("path" to SwingClip.trim(path, startSec, endSec)))
      } catch (e: Throwable) {
        promise.reject("TRIM_CLIP", e.message ?: "trim failed", e)
      }
    }

    /**
     * Remove a recording the flow is finished with — a source the trim replaced, or a take
     * the golfer binned. `false` (already gone) is a normal answer, never an error: the
     * caller's goal is "not on disk", and it isn't.
     */
    AsyncFunction("deleteClip") { path: String ->
      File(path).delete()
    }

    /** What the constrained-high-speed map offers, read from CameraCharacteristics directly. */
    AsyncFunction("camera2Capabilities") { promise: Promise ->
      try {
        promise.resolve(Camera2HighSpeed(context).capabilities())
      } catch (e: Throwable) {
        promise.reject("CAMERA2_QUERY", e.message ?: "failed to read camera2 characteristics", e)
      }
    }
  }

  private companion object {
    /** Out of 100 — quiet on purpose; the tick must never read as the record cue. */
    const val TICK_VOLUME = 40
    const val TICK_MS = 80
  }
}
