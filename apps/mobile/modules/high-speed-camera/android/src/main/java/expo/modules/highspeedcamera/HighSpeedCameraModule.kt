package expo.modules.highspeedcamera

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

  override fun definition() = ModuleDefinition {
    Name("HighSpeedCamera")

    /** What the constrained-high-speed map offers, read from CameraCharacteristics directly. */
    AsyncFunction("camera2Capabilities") { promise: Promise ->
      try {
        promise.resolve(Camera2HighSpeed(context).capabilities())
      } catch (e: Throwable) {
        promise.reject("CAMERA2_QUERY", e.message ?: "failed to read camera2 characteristics", e)
      }
    }

    /** Record `seconds` at exactly `fps`. Fails loudly rather than degrading. */
    AsyncFunction("camera2Record") { fps: Int, seconds: Int, promise: Promise ->
      try {
        Camera2HighSpeed(context).record(fps, seconds) { result ->
          result.fold(
            onSuccess = { path ->
              promise.resolve(mapOf("path" to path, "requestedFps" to fps, "api" to "camera2"))
            },
            onFailure = { e ->
              promise.reject("CAMERA2_RECORD", e.message ?: "high-speed record failed", null)
            },
          )
        }
      } catch (e: Throwable) {
        promise.reject("CAMERA2_RECORD", e.message ?: "high-speed record failed", e)
      }
    }
  }
}
