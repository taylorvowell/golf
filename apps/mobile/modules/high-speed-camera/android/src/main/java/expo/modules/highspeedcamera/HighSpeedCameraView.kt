package expo.modules.highspeedcamera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * The capture screen's live preview — an ordinary Camera2 repeating preview session on a
 * `TextureView`, with facing and zoom as props.
 *
 * Deliberately a SEPARATE session from `Camera2HighSpeed`'s constrained recording session
 * for now: the session-mode UI needs a live picture (D61 step 04); merging preview and
 * high-speed record into ONE constrained session — so the picture never blinks between
 * preview and capture — is the rest of that step and changes this class, not its callers.
 *
 * House rules honoured (docs/decisions/mobile-client.md):
 *   - EVERY property the lifecycle touches is declared ABOVE any code that runs at init —
 *     Kotlin runs initializers in source order, and Expo swallows the throw from a null
 *     field into an ErrorGroupView whose only symptom is a cast error somewhere healthy.
 *   - The camera is released on every teardown path (surface destroyed, view detached,
 *     facing change) — a leaked Camera2 session bricks the camera until app kill.
 */
@SuppressLint("ViewConstructor")
class HighSpeedCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private companion object { const val TAG = "SwingSagePreview" }

  // -- State (declared before the init block that adds the TextureView; see class comment) --
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var previewSize: Size? = null
  private var facing: String = "back"
  private var zoom: Float = 1f
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
    facing = next
    if (texture.isAvailable) {
      closeCamera()
      openCamera()
    }
  }

  fun setZoom(next: Float) {
    zoom = next
    applyZoom()
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

  @SuppressLint("MissingPermission") // JS gates mounting on the CAMERA grant.
  private fun openCamera() {
    val id = cameraId() ?: run { Log.w(TAG, "no $facing camera"); return }
    val gen = ++generation
    val t = HandlerThread("swingsage-preview").apply { start() }
    thread = t
    handler = Handler(t.looper)

    // 16:9 preview buffer, largest at or under 1080p — plenty for a viewfinder, cheap to draw.
    val map = manager.getCameraCharacteristics(id)
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
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
        }
      }, handler)
    } catch (e: Throwable) {
      Log.w(TAG, "openCamera failed: ${e.message}")
    }
  }

  private fun startPreview(cam: CameraDevice, gen: Int) {
    val st = texture.surfaceTexture ?: return
    val size = previewSize ?: Size(1920, 1080)
    st.setDefaultBufferSize(size.width, size.height)
    post { applyTransform(texture.width, texture.height) }
    val surface = Surface(st)
    try {
      @Suppress("DEPRECATION") // Consistent with the module's recording path; see its comment.
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
          val range = manager.getCameraCharacteristics(cam.id)
            .get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
          val clamped = zoom.coerceIn(range?.lower ?: 1f, range?.upper ?: 1f)
          set(CaptureRequest.CONTROL_ZOOM_RATIO, clamped)
        }
      }.build()
      s.setRepeatingRequest(request, null, handler)
    } catch (e: Throwable) {
      Log.w(TAG, "applyZoom failed: ${e.message}")
    }
  }

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
    runCatching { session?.close() }
    session = null
    runCatching { device?.close() }
    device = null
    thread?.quitSafely()
    thread = null
    handler = null
  }
}
