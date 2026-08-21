package expo.modules.highspeedcamera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import kotlin.math.sqrt

/**
 * The capture surface: ONE camera device, two session shapes.
 *
 * Preview and record share a device because the alternative — a preview session in this view and a
 * separate recording session in `Camera2HighSpeed` — cannot both hold the camera. Recording used to
 * mean tearing the preview down, and the golfer's picture went black at the exact moment they
 * needed to see themselves in frame.
 *
 * **Idle** is an ordinary repeating preview onto the `TextureView`. **Recording** is a
 * `CameraConstrainedHighSpeedCaptureSession` over TWO surfaces — the same preview surface plus the
 * recorder's — so the picture stays live at the capture rate. Two is not a design choice: a
 * constrained high-speed session accepts at most two outputs, which is also why nothing can sample
 * frames for motion detection while high-speed recording is running (audio can, and does).
 *
 * ## The lines that decide whether this works at all
 *
 * `createConstrainedHighSpeedCaptureSession(surfaces, callback, handler)` — the DEPRECATED overload.
 * `SessionConfiguration(SESSION_HIGH_SPEED, …)` is *swallowed* on the S25+: the camera opens and
 * then neither `onConfigured` nor `onConfigureFailed` ever fires. Silence, not refusal (D38/D39).
 *
 * `createHighSpeedRequestList` + `setRepeatingBurst` — a constrained session rejects a plain
 * repeating request, because frames are delivered in batches.
 *
 * `setCaptureRate` must equal `setVideoFrameRate`. A mismatch writes a slow-motion file whose
 * timestamps lie about the capture rate, which is worse than failing.
 *
 * ## House rules honoured (docs/decisions/mobile-client.md)
 *
 *   - EVERY property the lifecycle touches is declared ABOVE any code that runs at init — Kotlin
 *     runs initializers in source order, and Expo swallows the throw from a null field into an
 *     ErrorGroupView whose only symptom is a cast error somewhere healthy.
 *   - The camera is released on every teardown path (surface destroyed, view detached, facing
 *     change, record failure) — a leaked Camera2 session bricks the camera until app kill.
 */
@SuppressLint("ViewConstructor")
class HighSpeedCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private companion object {
    const val TAG = "SwingSagePreview"

    /**
     * Bits per pixel at 30fps. Everything above that scales by **sqrt(fps/30)**, not linearly.
     *
     * The old formula was `w * h * fps * 0.25` — pixels times a flat per-frame allowance — which
     * asks for 124 Mbps at 1080p240 and roughly triples what the encoder needs. At high frame rates
     * adjacent frames are nearly identical, so inter-frame prediction gets dramatically cheaper per
     * frame and bits-per-pixel should FALL as the rate rises. Square root is the conservative middle
     * between "flat" (grossly over-allocated) and "constant total bitrate" (starves a fast swing of
     * detail exactly where it matters).
     *
     * These are provisional. The honest numbers come from recording one swing across a bitrate
     * sweep and diffing the pipeline output with `scripts/compare_analysis.py` — watching CLUB
     * coverage, which degrades long before pose does.
     */
    const val BPP_AT_30 = 0.15

    /** Ceiling on any computed bitrate — a guard against a pathological size/rate combination. */
    const val MAX_BITRATE = 200_000_000
  }

  // -- State (declared before the init block that adds the TextureView; see class comment) --
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var previewSize: Size? = null
  private var facing: String = "back"
  private var zoom: Float = 1f
  /** The open lens's CONTROL_ZOOM_RATIO_RANGE, read once per open and reused by every
   * zoom apply — re-reading characteristics on each slider tick is a syscall per frame. */
  private var zoomRange: Pair<Float, Float> = 1f to 1f

  // -- Recording state --
  private var recorder: MediaRecorder? = null
  private var recordFile: File? = null
  private var recordSurface: Surface? = null
  /** The rate the session was actually configured at — never the rate that was asked for. */
  private var achievedFps: Int = 0
  private var recordStartedAtMs: Long = 0L
  private var recording: Boolean = false

  /**
   * Reports the lens's zoom range to JS so the slider spans what the lens can actually do. Declared
   * with the rest of the state, above the init block (see the class comment) — a delegated property
   * used before its initializer runs fails as a cast error somewhere healthy.
   */
  private val onZoomRange by EventDispatcher()
  /**
   * Fires when recording ends WITHOUT a `stopRecording` call — the hard cap elapsing, or the camera
   * failing mid-take. JS cannot poll for either, and a capture screen that sits on "Recording…"
   * after the recorder stopped is the worst of the available failures.
   */
  private val onRecordingEnded by EventDispatcher()
  /** Generation counter: a callback from a superseded open must not resurrect a session. */
  private var generation = 0

  private val texture = TextureView(context)

  init {
    addView(texture, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        openCamera()
      }
      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
        applyTransform(width, height)
      }
      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        closeCamera()
        return true
      }
      override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit
    }
  }

  fun setFacing(next: String) {
    if (next == facing) return
    // Never mid-take: swapping the lens would abandon a MediaRecorder holding an open file.
    if (recording) { Log.w(TAG, "ignoring facing change while recording"); return }
    facing = next
    if (texture.isAvailable) {
      closeCamera()
      openCamera()
    }
  }

  fun setZoom(next: Float) {
    zoom = next
    if (!recording) applyZoom()
  }

  override fun onDetachedFromWindow() {
    closeCamera()
    super.onDetachedFromWindow()
  }

  private val manager get() = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  private fun cameraId(): String? {
    val want = if (facing == "front") CameraCharacteristics.LENS_FACING_FRONT
    else CameraCharacteristics.LENS_FACING_BACK
    return manager.cameraIdList.firstOrNull {
      manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == want
    }
  }

  // ---------------------------------------------------------------- capabilities

  /**
   * The best high-speed configuration at or below `maxFps`, or null when the lens offers none.
   *
   * Rate first, resolution second — the deliberate inversion of the old `record()` helper, which
   * took the LARGEST size offering an exact rate. Frames are what the club detector is starved of
   * (a head travels ~0.75 m between frames at 60fps and ~0.19 m at 240), while everything above 720
   * on the short side is discarded by the analyzer's own downscale before a keypoint is computed.
   * So spend the budget on time and take the smallest size that still clears 720.
   */
  private fun bestHighSpeed(id: String, maxFps: Int): Pair<Size, Range<Int>>? {
    val map = manager.getCameraCharacteristics(id)
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
    var best: Pair<Size, Range<Int>>? = null
    for (size in map.highSpeedVideoSizes) {
      // 720 short side is the analyzer's own CV input (video.py). Below it we would be throwing
      // away detail the pipeline WOULD have used; above it we are paying for detail it discards.
      if (minOf(size.width, size.height) < 720) continue
      for (range in map.getHighSpeedVideoFpsRangesFor(size)) {
        if (range.upper > maxFps) continue
        val current = best
        if (current == null ||
          range.upper > current.second.upper ||
          (range.upper == current.second.upper &&
            size.width * size.height < current.first.width * current.first.height)
        ) {
          best = size to range
        }
      }
    }
    return best
  }

  private fun bitrateFor(size: Size, fps: Int): Int {
    val base = size.width.toDouble() * size.height.toDouble() * 30.0 * BPP_AT_30
    return (base * sqrt(fps.toDouble() / 30.0)).toInt().coerceAtMost(MAX_BITRATE)
  }

  // ---------------------------------------------------------------- open / preview

  @SuppressLint("MissingPermission") // JS gates mounting on the CAMERA grant.
  private fun openCamera() {
    val id = cameraId() ?: run { Log.w(TAG, "no $facing camera"); return }
    val gen = ++generation
    val t = HandlerThread("swingsage-preview").apply { start() }
    thread = t
    handler = Handler(t.looper)

    val chars = manager.getCameraCharacteristics(id)

    // What this lens can do, published before the first frame so the slider never renders
    // against a guessed range. Pre-31 devices have no zoom-ratio control at all; their
    // digital-zoom ceiling is the honest upper bound.
    zoomRange = if (Build.VERSION.SDK_INT >= 30) {
      val r = chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
      (r?.lower ?: 1f) to (r?.upper ?: 1f)
    } else {
      1f to (chars.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f)
    }
    onZoomRange(mapOf("min" to zoomRange.first.toDouble(), "max" to zoomRange.second.toDouble()))

    // 16:9 preview buffer, largest at or under 1080p — plenty for a viewfinder, cheap to draw.
    val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    previewSize = map?.getOutputSizes(SurfaceTexture::class.java)
      ?.filter { it.width * 9 == it.height * 16 && it.height <= 1080 }
      ?.maxByOrNull { it.width * it.height }
      ?: Size(1920, 1080)

    try {
      manager.openCamera(id, object : CameraDevice.StateCallback() {
        override fun onOpened(cam: CameraDevice) {
          if (gen != generation) { cam.close(); return }
          device = cam
          startPreview(cam, gen)
        }
        override fun onDisconnected(cam: CameraDevice) { cam.close(); if (gen == generation) device = null }
        override fun onError(cam: CameraDevice, error: Int) {
          Log.w(TAG, "preview camera error $error")
          cam.close()
          if (gen == generation) device = null
          failRecording("camera error $error")
        }
      }, handler)
    } catch (e: Throwable) {
      Log.w(TAG, "openCamera failed: ${e.message}")
    }
  }

  private fun previewSurface(): Surface? {
    val st = texture.surfaceTexture ?: return null
    val size = previewSize ?: Size(1920, 1080)
    st.setDefaultBufferSize(size.width, size.height)
    return Surface(st)
  }

  private fun startPreview(cam: CameraDevice, gen: Int) {
    val surface = previewSurface() ?: return
    post { applyTransform(texture.width, texture.height) }
    try {
      @Suppress("DEPRECATION") // Consistent with the recording path; see the class comment.
      cam.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
          if (gen != generation) { runCatching { s.close() }; return }
          session = s
          applyZoom()
        }
        override fun onConfigureFailed(s: CameraCaptureSession) {
          Log.w(TAG, "preview session refused")
        }
      }, handler)
    } catch (e: Throwable) {
      Log.w(TAG, "createCaptureSession failed: ${e.message}")
    }
  }

  /** (Re)issues the repeating request — also how a zoom change lands without a new session. */
  private fun applyZoom() {
    val cam = device ?: return
    val s = session ?: return
    try {
      val request = cam.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
        addTarget(Surface(texture.surfaceTexture ?: return))
        if (Build.VERSION.SDK_INT >= 30) {
          set(CaptureRequest.CONTROL_ZOOM_RATIO, zoom.coerceIn(zoomRange.first, zoomRange.second))
        }
      }.build()
      s.setRepeatingRequest(request, null, handler)
    } catch (e: Throwable) {
      Log.w(TAG, "applyZoom failed: ${e.message}")
    }
  }

  // ---------------------------------------------------------------- record

  /**
   * Begin recording at the highest rate at or below `maxFps` the lens actually offers.
   *
   * `maxSeconds` is a HARD cap enforced by `MediaRecorder.setMaxDuration`, not by a posted runnable
   * — the recorder finalises the file itself, so a cap reached while JS is busy still produces a
   * playable MP4 rather than a truncated one. It fires `onRecordingEnded` so the capture screen can
   * move to review without having asked.
   */
  @SuppressLint("MissingPermission")
  fun startRecording(maxFps: Int, maxSeconds: Int, promise: (Result<Map<String, Any>>) -> Unit) {
    if (recording) return promise(Result.failure(IllegalStateException("already recording")))
    val cam = device ?: return promise(Result.failure(IllegalStateException("camera is not open")))
    val id = cameraId() ?: return promise(Result.failure(IllegalStateException("no $facing camera")))
    val h = handler ?: return promise(Result.failure(IllegalStateException("no camera thread")))

    val (size, range) = bestHighSpeed(id, maxFps)
      ?: return promise(Result.failure(IllegalStateException(
        "this lens offers no high-speed configuration at or below ${maxFps}fps"
      )))
    val fps = range.upper

    val file = File(context.cacheDir, "swing_${fps}fps_${System.currentTimeMillis()}.mp4")
    val rec = try {
      MediaRecorder(context).apply {
        // Audio is not a nicety here — it is the ONLY signal that can locate impact. A constrained
        // high-speed session permits two output surfaces (preview + recorder) with nothing left to
        // sample frames from, so motion detection is impossible during a take and the strike's
        // sub-millisecond transient is what seeds the review window. It also gives the golfer the
        // sound of the strike on playback, which is the half they notice.
        setAudioSource(MediaRecorder.AudioSource.CAMCORDER)
        setVideoSource(MediaRecorder.VideoSource.SURFACE)
        setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        // 44.1kHz mono: a strike is broadband and short, so the rate matters and the second channel
        // does not. Mono also halves what the detector decodes.
        setAudioSamplingRate(44_100)
        setAudioChannels(1)
        setAudioEncodingBitRate(128_000)
        setOutputFile(file.absolutePath)
        setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        setVideoSize(size.width, size.height)
        // Both the SAME — see the class comment. A mismatch writes a file whose timestamps lie.
        setVideoFrameRate(fps)
        setCaptureRate(fps.toDouble())
        setVideoEncodingBitRate(bitrateFor(size, fps))
        setMaxDuration(maxSeconds * 1000)
        setOnInfoListener { _, what, _ ->
          if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
            // The recorder has already finalised the file; settle the same way a tap would.
            val result = settleRecording()
            onRecordingEnded(
              result.getOrNull()?.plus("reason" to "cap")
                ?: mapOf("reason" to "error", "error" to (result.exceptionOrNull()?.message ?: "unknown")),
            )
          }
        }
        prepare()
      }
    } catch (e: Throwable) {
      return promise(Result.failure(e))
    }

    val recSurface = rec.surface
    val preview = previewSurface() ?: run {
      runCatching { rec.reset(); rec.release() }
      return promise(Result.failure(IllegalStateException("preview surface is gone")))
    }

    recorder = rec
    recordFile = file
    recordSurface = recSurface
    achievedFps = fps

    // The idle preview session must go before a constrained one can take the device.
    runCatching { session?.close() }
    session = null

    Log.i(TAG, "record: ${size.width}x${size.height} @ $fps, cap ${maxSeconds}s, ${bitrateFor(size, fps)}bps")

    try {
      @Suppress("DEPRECATION") // The modern overload is swallowed on this device; see the class comment.
      cam.createConstrainedHighSpeedCaptureSession(
        listOf(preview, recSurface),
        object : CameraCaptureSession.StateCallback() {
          override fun onConfigured(s: CameraCaptureSession) {
            try {
              session = s
              val highSpeed = s as CameraConstrainedHighSpeedCaptureSession
              val request = cam.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                // BOTH targets: the golfer keeps seeing themselves at the capture rate. This is
                // the whole reason preview and record share one session.
                addTarget(preview)
                addTarget(recSurface)
                set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                if (Build.VERSION.SDK_INT >= 30) {
                  set(
                    CaptureRequest.CONTROL_ZOOM_RATIO,
                    zoom.coerceIn(zoomRange.first, zoomRange.second),
                  )
                }
              }.build()
              // Mandatory: a constrained session rejects a plain repeating request, because the
              // frames are delivered in batches.
              highSpeed.setRepeatingBurst(highSpeed.createHighSpeedRequestList(request), null, h)
              rec.start()
              recording = true
              recordStartedAtMs = System.currentTimeMillis()
              promise(Result.success(mapOf(
                "fps" to fps,
                "width" to size.width,
                "height" to size.height,
                "maxSeconds" to maxSeconds,
              )))
            } catch (e: Throwable) {
              teardownRecorder()
              promise(Result.failure(e))
              restorePreview()
            }
          }

          override fun onConfigureFailed(s: CameraCaptureSession) {
            teardownRecorder()
            promise(Result.failure(IllegalStateException(
              "device REFUSED a high-speed session at ${size.width}x${size.height}@$fps"
            )))
            restorePreview()
          }
        },
        h,
      )
    } catch (e: Throwable) {
      teardownRecorder()
      promise(Result.failure(e))
      restorePreview()
    }
  }

  /** Stop by tap. The cap path settles through `setOnInfoListener` instead, never through here. */
  fun stopRecording(promise: (Result<Map<String, Any>>) -> Unit) {
    if (!recording) return promise(Result.failure(IllegalStateException("not recording")))
    promise(settleRecording())
  }

  /**
   * The one place a take ends: stop the burst, stop the recorder, hand back the file, go back to
   * preview. Both endings (tap, cap) route through here so they cannot diverge.
   *
   * A `MediaRecorder.stop()` that throws means the take was too short to produce a valid MP4 —
   * a real outcome (a double-tap), reported rather than left as a zero-byte file.
   */
  private fun settleRecording(): Result<Map<String, Any>> {
    if (!recording) return Result.failure(IllegalStateException("not recording"))
    recording = false
    val file = recordFile
    val durationMs = System.currentTimeMillis() - recordStartedAtMs

    runCatching { (session as? CameraConstrainedHighSpeedCaptureSession)?.stopRepeating() }
    val stopped = runCatching { recorder?.stop() }
    teardownRecorder()
    restorePreview()

    return if (stopped.isFailure || file == null || !file.exists() || file.length() == 0L) {
      runCatching { file?.delete() }
      Result.failure(IllegalStateException(
        "the take was too short to write a valid video — hold the recording for at least a second"
      ))
    } else {
      Result.success(mapOf(
        "path" to file.absolutePath,
        "fps" to achievedFps,
        "durationMs" to durationMs,
        "bytes" to file.length(),
      ))
    }
  }

  /** Camera died mid-take: end it as a reported failure rather than a screen that never moves. */
  private fun failRecording(reason: String) {
    if (!recording) return
    recording = false
    teardownRecorder()
    onRecordingEnded(mapOf("reason" to "error", "error" to reason))
  }

  private fun teardownRecorder() {
    runCatching { recorder?.reset(); recorder?.release() }
    recorder = null
    runCatching { recordSurface?.release() }
    recordSurface = null
  }

  /** Back to the idle repeating preview after a take, so the next swing can be framed. */
  private fun restorePreview() {
    val cam = device ?: return
    runCatching { session?.close() }
    session = null
    startPreview(cam, generation)
  }

  // ---------------------------------------------------------------- teardown

  /** Centre-crop: preserve the buffer's aspect and fill the view, never stretch the golfer. */
  private fun applyTransform(viewW: Int, viewH: Int) {
    if (viewW == 0 || viewH == 0) return
    val size = previewSize ?: return
    // Portrait-locked app: the sensor buffer displays rotated, so its on-screen aspect is
    // height:width.
    val displayedAspect = size.height.toFloat() / size.width.toFloat()
    val viewAspect = viewW.toFloat() / viewH.toFloat()
    val m = Matrix()
    if (displayedAspect > viewAspect) {
      m.setScale(displayedAspect / viewAspect, 1f, viewW / 2f, viewH / 2f)
    } else {
      m.setScale(1f, viewAspect / displayedAspect, viewW / 2f, viewH / 2f)
    }
    texture.setTransform(m)
  }

  private fun closeCamera() {
    generation++
    if (recording) {
      recording = false
      runCatching { recorder?.stop() }
    }
    teardownRecorder()
    runCatching { session?.close() }
    session = null
    runCatching { device?.close() }
    device = null
    thread?.quitSafely()
    thread = null
    handler = null
  }
}
