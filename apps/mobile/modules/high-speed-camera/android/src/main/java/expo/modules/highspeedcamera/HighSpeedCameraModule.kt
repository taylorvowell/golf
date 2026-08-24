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
      // onCaptureConfig: the probed rate/size this lens will record at — the FPS pill's only
      // source, so the number on screen is never a request.
      Events("onZoomRange", "onRecordingEnded", "onCaptureConfig")

      // The hook the house rule points at for deterministic native release — it still runs
      // when a view is destroyed while already detached, which `onDetachedFromWindow` does
      // not. Releasing twice is safe; not releasing at all holds the camera until app kill.
      OnViewDestroys { view: HighSpeedCameraView -> view.releaseCamera() }
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
    AsyncFunction("detectImpacts") {
      path: String, limit: Int, method: String?, edgeWeighting: Boolean?, promise: Promise ->
      try {
        val found = SwingClip.detectImpacts(
          path,
          limit,
          SwingClip.Method.parse(method),
          edgeWeighting ?: true,
        )
        promise.resolve(found.map { mapOf("timeSec" to it.timeSec, "score" to it.score) })
      } catch (e: Throwable) {
        promise.reject("DETECT_IMPACTS", e.message ?: "impact detection failed", e)
      }
    }

    /**
     * The filmstrip under the review scrubber: `count` evenly spaced frames as JPEG paths.
     *
     * Runs on the module's own queue, never the main thread — decoding even a dozen frames
     * takes long enough to drop the review screen's first animation.
     */
    AsyncFunction("clipThumbnails") { path: String, count: Int, width: Int, promise: Promise ->
      try {
        promise.resolve(SwingClip.thumbnails(path, count, width, context.cacheDir))
      } catch (e: Throwable) {
        promise.reject("CLIP_THUMBNAILS", e.message ?: "thumbnail extraction failed", e)
      }
    }

    /** The same strip, at times the caller chooses — for a non-linear scrub axis. */
    AsyncFunction("clipThumbnailsAt") { path: String, timesSec: List<Double>, width: Int, promise: Promise ->
      try {
        promise.resolve(SwingClip.thumbnailsAt(path, timesSec, width, context.cacheDir))
      } catch (e: Throwable) {
        promise.reject("CLIP_THUMBNAILS_AT", e.message ?: "thumbnail extraction failed", e)
      }
    }

    /**
     * Delete capture leftovers: takes and filmstrips older than `keepNewerThanMs`.
     *
     * Called when the capture screen mounts. Without it the cache only grows — a phone in
     * real use reached 1.8 GB of stranded takes and thumbnails (measured 2026-08-21), and
     * spec §02.12 asks for exactly this sweep.
     */
    AsyncFunction("sweepCaptureCache") { keepNewerThanMs: Double, promise: Promise ->
      try {
        promise.resolve(SwingClip.sweepOrphans(context.cacheDir, keepNewerThanMs.toLong()))
      } catch (e: Throwable) {
        promise.reject("SWEEP_CACHE", e.message ?: "cache sweep failed", e)
      }
    }

    /**
     * Pre-recorded clips to stand in for a live take (`__DEV__` only — see `devClipsFolder`).
     *
     * Answers with the folder either way, so an empty drawer can tell the developer where to
     * push files instead of just saying "none".
     */
    AsyncFunction("devClips") { promise: Promise ->
      try {
        val dirs = devClipFolders()
        // Every folder is scanned so clips already pushed to the old location still show up,
        // but only the FIRST is named — a drawer that offers two paths to choose between is a
        // drawer that gets files put in the wrong one.
        promise.resolve(mapOf(
          "folder" to (dirs.firstOrNull()?.absolutePath ?: ""),
          "clips" to dirs.flatMap { SwingClip.listDevClips(it) },
        ))
      } catch (e: Throwable) {
        promise.reject("DEV_CLIPS", e.message ?: "could not list dev clips", e)
      }
    }

    /** Remux a window out of a take — no re-encode, so it costs milliseconds and loses nothing. */
    AsyncFunction("trimClip") { path: String, startSec: Double, endSec: Double, promise: Promise ->
      try {
        promise.resolve(mapOf("path" to SwingClip.trim(path, startSec, endSec, context.cacheDir)))
      } catch (e: Throwable) {
        promise.reject("TRIM_CLIP", e.message ?: "trim failed", e)
      }
    }

    /**
     * What an ARBITRARY clip is, read from its own container — for imports, which arrive
     * without the recorder's knowledge. `captureFps` is the slow-motion truth (the
     * `com.android.capture.fps` the camera stamped, surfaced by the platform as
     * CAPTURE_FRAMERATE): a phone slow-mo is captured at 240 and WRITTEN at 30, so its
     * timeline runs slower than the world by captureFps/videoFps. Zero means "not stamped" —
     * an ordinary real-time clip — and the caller must treat it that way, never as a rate.
     */
    AsyncFunction("probeClip") { path: String, promise: Promise ->
      try {
        val mmr = android.media.MediaMetadataRetriever()
        try {
          mmr.setDataSource(path)
          val capture = mmr.extractMetadata(
            android.media.MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE,
          )?.toDoubleOrNull() ?: 0.0
          val durationMs = mmr.extractMetadata(
            android.media.MediaMetadataRetriever.METADATA_KEY_DURATION,
          )?.toLongOrNull() ?: 0L
          // There is no frame-rate retriever key; the playback rate is frames over duration.
          val frames = mmr.extractMetadata(
            android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT,
          )?.toDoubleOrNull() ?: 0.0
          val video = if (frames > 0 && durationMs > 0) frames * 1000.0 / durationMs else 0.0
          promise.resolve(mapOf(
            "captureFps" to capture,
            "videoFps" to video,
            "durationMs" to durationMs,
          ))
        } finally {
          mmr.release()
        }
      } catch (e: Throwable) {
        promise.reject("PROBE_CLIP", e.message ?: "could not read clip metadata", e)
      }
    }

    /**
     * Remove a recording the flow is finished with — a source the trim replaced, or a take
     * the golfer binned. `false` (already gone) is a normal answer, never an error: the
     * caller's goal is "not on disk", and it isn't.
     */
    AsyncFunction("deleteClip") { path: String ->
      // The take's filmstrip goes with the take — those JPEGs are named after it and nothing
      // else will ever claim them.
      SwingClip.deleteThumbnails(path)
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

  /**
   * Where a developer drops pre-recorded swings, in preference order.
   *
   * **`Android/media/<pkg>/dev-clips` is the one to use.** It is the only location that is both
   * writable by this app with NO permission declared and still visible to Windows Explorer over
   * USB and to the phone's own file manager — Android 11's scoped-storage lockdown covers
   * `Android/data` and `Android/obb` but deliberately not `Android/media`. A public folder
   * (`Movies`, `DCIM`) would need `READ_MEDIA_VIDEO`, and a permission declared for a debug-only
   * convenience ships in the release manifest and onto the store's data-safety form.
   *
   * `Android/data/<pkg>/files/dev-clips` stays in the list as a fallback: it was the first
   * choice, clips may already sit there, and `getExternalMediaDirs` is deprecated (still
   * functional) so a device that answers null must still have somewhere to look.
   *
   * All created on demand so the drawer can name a path that exists.
   */
  @Suppress("DEPRECATION")
  private fun devClipFolders(): List<File> = listOfNotNull(
    context.externalMediaDirs.firstOrNull()?.let { File(it, "dev-clips") },
    File(context.getExternalFilesDir(null), "dev-clips"),
  ).onEach { runCatching { it.mkdirs() } }

  private companion object {
    /** Out of 100 — quiet on purpose; the tick must never read as the record cue. */
    const val TICK_VOLUME = 40
    const val TICK_MS = 80
  }
}
