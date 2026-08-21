package expo.modules.highspeedcamera

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager

/**
 * The constrained-high-speed capability probe, read straight from `CameraCharacteristics`
 * rather than from any library's interpretation of it.
 *
 * ## Why Camera2 directly, when two libraries already failed
 *
 * D37: `react-native-vision-camera` v5 opens an ordinary `CameraCaptureSession` and returned 60fps
 * for every request, without an error. D38: CameraX 1.5 refused outright, because it gates
 * high-speed on `CamcorderProfile` and this device publishes **zero** high-speed CamcorderProfile
 * entries — while Camera2's own characteristics advertise 1080p at 120 and 240.
 *
 * This class once also held a standalone record-to-file path — the experiment that proved the
 * S25+ delivers 1080p@240 to a third-party app (D39). That path was superseded by
 * [HighSpeedCameraView], where the take shares the preview's camera device, and was deleted;
 * the session mechanics that made it work (the deprecated
 * `createConstrainedHighSpeedCaptureSession` overload, capture rate == frame rate) live on in
 * the view with their own comments.
 */
class Camera2HighSpeed(private val context: Context) {

  private val manager get() = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  private fun backCameraId(): String =
    manager.cameraIdList.firstOrNull { id ->
      manager.getCameraCharacteristics(id)
        .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
    } ?: throw IllegalStateException("no back-facing camera")

  /** What the constrained-high-speed configuration map actually offers on the back lens. */
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
}
