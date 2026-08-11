package expo.modules.highspeedcamera

import android.content.Context
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.MediaRecorder
import android.os.Handler
import android.os.HandlerThread
import android.util.Range
import android.util.Size
import java.io.File
import java.util.concurrent.Executor

/**
 * Constrained high-speed capture, through Camera2 directly.
 *
 * ## Why this exists, when two libraries already failed
 *
 * D37: `react-native-vision-camera` v5 opens an ordinary `CameraCaptureSession` and returned 60fps
 * for every request, without an error. D38: CameraX 1.5 refused outright, because it gates
 * high-speed on `CamcorderProfile` and this device publishes **zero** high-speed CamcorderProfile
 * entries — while Camera2's own characteristics advertise 1080p at 120 and 240, and Samsung's
 * vendor key goes further still (4K@120, 1080p@240, 720p@240).
 *
 * `createConstrainedHighSpeedCaptureSession` is the only API that reads those configurations. It
 * is what Samsung's own slow-motion mode uses. This class is the experiment that settles whether a
 * third-party app can reach it on this device — Samsung is reported to cap third-party high-speed,
 * so a refusal here is a real answer and not a bug to work around.
 *
 * ## The two rules that make the result trustworthy
 *
 * **`setCaptureRate` must equal `setVideoFrameRate`.** MediaRecorder's capture rate is what writes
 * the timestamps. Set capture to 240 and frame rate to 30 and you get a slow-motion file: 240
 * frames per second of real time, stamped as though they were 30 — which is exactly the re-timing
 * D37's amendment banned, because the analyzer would then read every frame index wrong against a
 * file that looks healthy. Both are set to the requested rate so the artifact is TRUE high-rate
 * video.
 *
 * **The requested range must match exactly.** A request for 240 served at 120 fails loudly rather
 * than rounding down, because rounding down silently is the entire failure this module exists to
 * eliminate.
 */
class Camera2HighSpeed(private val context: Context) {

  private val manager get() = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  private fun backCameraId(): String =
    manager.cameraIdList.firstOrNull { id ->
      manager.getCameraCharacteristics(id)
        .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
    } ?: throw IllegalStateException("no back-facing camera")

  /**
   * What the constrained-high-speed configuration map actually offers, read straight from
   * `CameraCharacteristics` rather than from any library's interpretation of it.
   */
  fun capabilities(): Map<String, Any> {
    val id = backCameraId()
    val chars = manager.getCameraCharacteristics(id)
    val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?: return mapOf("supported" to false, "reason" to "no stream configuration map")

    val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
    val declaresHighSpeed = caps.contains(
      CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO
    )

    val entries = mutableListOf<String>()
    for (size in map.highSpeedVideoSizes) {
      for (range in map.getHighSpeedVideoFpsRangesFor(size)) {
        entries.add("${size.width}x${size.height}@${range.lower}-${range.upper}")
      }
    }

    return mapOf(
      "supported" to (declaresHighSpeed && entries.isNotEmpty()),
      "declaresCapability" to declaresHighSpeed,
      "configurations" to entries,
      // The normal-session ceiling, for contrast. Samsung is reported to cap third-party apps here;
      // seeing 30 next to a 240 high-speed entry is the shape that report predicts.
      "normalFpsRanges" to (chars.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        ?.map { "${it.lower}-${it.upper}" } ?: emptyList<String>()),
    )
  }

  /** Record `seconds` at exactly `fps`, returning the file path. Throws rather than degrading. */
  fun record(fps: Int, seconds: Int, onDone: (Result<String>) -> Unit) {
    val id = backCameraId()
    val chars = manager.getCameraCharacteristics(id)
    val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?: return onDone(Result.failure(IllegalStateException("no stream configuration map")))

    // Largest size that offers the EXACT requested rate. Largest because the analyzer's pose and
    // club detection both lose accuracy with resolution, so trading pixels for frames is a real
    // cost and should not be taken silently.
    var chosen: Size? = null
    var chosenRange: Range<Int>? = null
    for (size in map.highSpeedVideoSizes) {
      val exact = map.getHighSpeedVideoFpsRangesFor(size)
        .firstOrNull { it.upper == fps && it.lower == fps }
        ?: map.getHighSpeedVideoFpsRangesFor(size).firstOrNull { it.upper == fps }
      if (exact != null) {
        if (chosen == null || size.width * size.height > chosen.width * chosen.height) {
          chosen = size
          chosenRange = exact
        }
      }
    }
    val size = chosen ?: return onDone(Result.failure(IllegalStateException(
      "no high-speed configuration offers ${fps}fps; device offers " +
        map.highSpeedVideoSizes.joinToString { s ->
          "${s.width}x${s.height}@" + map.getHighSpeedVideoFpsRangesFor(s)
            .joinToString("/") { "${it.lower}-${it.upper}" }
        }
    )))
    val range = chosenRange!!

    val thread = HandlerThread("camera2-high-speed").apply { start() }
    val handler = Handler(thread.looper)
    val executor = Executor { it.run() }

    val file = File(context.cacheDir, "camera2_${fps}fps_${System.currentTimeMillis()}.mp4")
    val recorder = MediaRecorder(context).apply {
      setVideoSource(MediaRecorder.VideoSource.SURFACE)
      setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      setOutputFile(file.absolutePath)
      setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      setVideoSize(size.width, size.height)
      // Both the SAME. See the class comment: a mismatch writes a slow-motion file whose
      // timestamps lie about the capture rate, which is the one outcome worse than failing.
      setVideoFrameRate(fps)
      setCaptureRate(fps.toDouble())
      // Roughly 4 bits per pixel per frame; a 240fps 1080p stream needs a lot of headroom, and an
      // under-specified bitrate shows up as dropped frames that look exactly like a rate cap.
      setVideoEncodingBitRate((size.width * size.height * fps * 0.25).toInt().coerceAtMost(200_000_000))
      prepare()
    }
    val surface = recorder.surface

    var opened: CameraDevice? = null
    val finish = { result: Result<String> ->
      runCatching { opened?.close() }
      runCatching { recorder.reset(); recorder.release() }
      thread.quitSafely()
      onDone(result)
    }

    manager.openCamera(id, executor, object : CameraDevice.StateCallback() {
      override fun onOpened(device: CameraDevice) {
        opened = device
        try {
          val config = SessionConfiguration(
            SessionConfiguration.SESSION_HIGH_SPEED,
            listOf(OutputConfiguration(surface)),
            executor,
            object : CameraCaptureSession.StateCallback() {
              override fun onConfigured(session: CameraCaptureSession) {
                try {
                  val highSpeed = session as CameraConstrainedHighSpeedCaptureSession
                  val request = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                    addTarget(surface)
                    set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                  }.build()
                  // createHighSpeedRequestList is mandatory: a constrained session rejects a plain
                  // repeating request, because the frames are delivered in batches.
                  highSpeed.setRepeatingBurst(
                    highSpeed.createHighSpeedRequestList(request), null, handler,
                  )
                  recorder.start()
                  handler.postDelayed({
                    runCatching { highSpeed.stopRepeating() }
                    runCatching { recorder.stop() }
                    finish(Result.success(file.absolutePath))
                  }, seconds * 1000L)
                } catch (e: Throwable) {
                  finish(Result.failure(e))
                }
              }

              override fun onConfigureFailed(session: CameraCaptureSession) {
                finish(Result.failure(IllegalStateException(
                  "device REFUSED a high-speed session at ${size.width}x${size.height}@$fps — " +
                    "this is the third-party restriction, not a coding error"
                )))
              }
            },
          )
          device.createCaptureSession(config)
        } catch (e: Throwable) {
          finish(Result.failure(e))
        }
      }

      override fun onDisconnected(device: CameraDevice) {
        finish(Result.failure(IllegalStateException("camera disconnected")))
      }

      override fun onError(device: CameraDevice, error: Int) {
        finish(Result.failure(IllegalStateException("camera error $error")))
      }
    })
  }
}
