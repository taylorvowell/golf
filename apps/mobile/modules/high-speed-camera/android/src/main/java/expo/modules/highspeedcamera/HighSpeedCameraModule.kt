package expo.modules.highspeedcamera

import android.annotation.SuppressLint
import android.content.Context
import android.util.Range
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalSessionConfig
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.ExperimentalHighSpeedVideo
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.HighSpeedVideoSessionConfig
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * True high-frame-rate capture, via CameraX 1.5's high-speed session.
 *
 * ## Why this exists at all
 *
 * D37 measured the S25+ recording 60fps when 120 and 240 were requested — no error, just 60. The
 * hardware is not the limit: `availableHighSpeedVideoConfigurations` advertises 1080p at both 120
 * and 240. Android exposes those only through a **constrained high-speed session**, and
 * `react-native-vision-camera` v5 opens an ordinary `CameraCaptureSession`, so no parameter it
 * accepts can reach them. CameraX 1.5 wraps that session type; this module is the thinnest
 * possible bridge to it.
 *
 * ## The one setting that must never change
 *
 * `setSlowMotionEnabled` is **never** set true. With it on, CameraX re-times the high-speed stream
 * and writes a standard **30fps** file — a 240fps capture would reach the analyzer as 30fps, every
 * frame index derived from it would be wrong, and the file would look completely healthy. That is
 * D37's silent degrade one layer deeper, and it is the exact failure shape this project keeps
 * paying for. We want the raw high-rate video; playback speed is a player concern.
 *
 * ## What this module does NOT do
 *
 * It does not judge its own output. `scripts/measure-capture.mjs` decodes the file and counts
 * frames, because asking the camera whether the camera degraded is not a measurement. The module's
 * contract is "produce an artifact and say where it is".
 */
class HighSpeedCameraModule : Module() {
  private var recording: Recording? = null

  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private val activity: LifecycleOwner
    get() = requireNotNull(appContext.currentActivity as? LifecycleOwner) {
      "no LifecycleOwner activity — CameraX must bind to one"
    }

  @SuppressLint("MissingPermission", "RestrictedApi")
  @OptIn(ExperimentalSessionConfig::class, ExperimentalHighSpeedVideo::class)
  override fun definition() = ModuleDefinition {
    Name("HighSpeedCamera")

    /**
     * What the device will ACTUALLY grant, asked of CameraX rather than of the spec sheet.
     *
     * `Recorder.getHighSpeedVideoCapabilities` returns null on a device with no high-speed support
     * at all, which is a different answer from "supports it but not at this rate" and is reported
     * as such — a probe that cannot tell those apart would send us hunting the wrong problem.
     */
    AsyncFunction("getSupportedFrameRates") { promise: Promise ->
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        try {
          val provider = future.get()
          val info = provider.getCameraInfo(CameraSelector.DEFAULT_BACK_CAMERA)
          val caps = Recorder.getHighSpeedVideoCapabilities(info)
          if (caps == null) {
            promise.resolve(mapOf("supported" to false, "ranges" to emptyList<String>()))
            return@addListener
          }
          val recorder = Recorder.Builder().build()
          val videoCapture: VideoCapture<Recorder> = VideoCapture.withOutput(recorder)
          val session = HighSpeedVideoSessionConfig.Builder(videoCapture).build()
          val ranges: List<Range<Int>> = info.getSupportedFrameRateRanges(session).toList()
          promise.resolve(
            mapOf(
              "supported" to true,
              "ranges" to ranges.map { "${it.lower}-${it.upper}" },
              "maxFps" to (ranges.maxOfOrNull { it.upper } ?: 0),
            )
          )
        } catch (e: Throwable) {
          promise.reject("HIGH_SPEED_QUERY", e.message ?: "failed to query high-speed support", e)
        }
      }, ContextCompat.getMainExecutor(context))
    }

    /** Record `seconds` of video at `fps`, returning the file path. */
    AsyncFunction("record") { fps: Int, seconds: Int, promise: Promise ->
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        try {
          val provider = future.get()
          val info = provider.getCameraInfo(CameraSelector.DEFAULT_BACK_CAMERA)
          Recorder.getHighSpeedVideoCapabilities(info)
            ?: throw IllegalStateException("device reports no high-speed video capability")

          val recorder = Recorder.Builder().build()
          val videoCapture: VideoCapture<Recorder> = VideoCapture.withOutput(recorder)
          val builder = HighSpeedVideoSessionConfig.Builder(videoCapture)

          // Pick the advertised range that actually matches the request. Choosing the nearest
          // instead would reintroduce exactly the silent degrade this module exists to remove:
          // a request for 240 quietly served at 120 must FAIL, loudly, not round down.
          val ranges = info.getSupportedFrameRateRanges(builder.build())
          val exact = ranges.firstOrNull { it.upper == fps && it.lower == fps }
            ?: ranges.firstOrNull { it.upper == fps }
            ?: throw IllegalStateException(
              "no high-speed range offers ${fps}fps; device offers " +
                ranges.joinToString { "${it.lower}-${it.upper}" }
            )
          builder.setFrameRateRange(exact)
          // NEVER true. See the class comment — it rewrites the file to 30fps.
          builder.setSlowMotionEnabled(false)

          provider.unbindAll()
          provider.bindToLifecycle(activity, CameraSelector.DEFAULT_BACK_CAMERA, builder.build())

          val file = File(context.cacheDir, "highspeed_${fps}fps_${System.currentTimeMillis()}.mp4")
          val options = FileOutputOptions.Builder(file).build()

          recording = recorder
            .prepareRecording(context, options)
            .start(ContextCompat.getMainExecutor(context)) { event ->
              if (event is VideoRecordEvent.Finalize) {
                provider.unbindAll()
                recording = null
                if (event.hasError()) {
                  promise.reject(
                    "HIGH_SPEED_RECORD",
                    "recording failed with error ${event.error}",
                    null,
                  )
                } else {
                  promise.resolve(
                    mapOf(
                      "path" to file.absolutePath,
                      "requestedFps" to fps,
                      "grantedRange" to "${exact.lower}-${exact.upper}",
                    )
                  )
                }
              }
            }

          ContextCompat.getMainExecutor(context).execute {
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
              recording?.stop()
            }, seconds * 1000L)
          }
        } catch (e: Throwable) {
          promise.reject("HIGH_SPEED_RECORD", e.message ?: "high-speed recording failed", e)
        }
      }, ContextCompat.getMainExecutor(context))
    }
  }
}
