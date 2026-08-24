package expo.modules.highspeedcamera

import android.annotation.SuppressLint
import android.content.Context
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
import android.os.Looper
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.sqrt

/**
 * The capture surface: ONE camera device, two session shapes.
 *
 * Preview and record share a device because the alternative — a preview session in this view and a
 * separate recording session in `Camera2HighSpeed` — cannot both hold the camera. Recording used to
 * mean tearing the preview down, and the golfer's picture went black at the exact moment they
 * needed to see themselves in frame.
 *
 * **Idle** is an ordinary repeating preview onto the `SurfaceView`. **Recording** is a
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
 * **The preview is a `SurfaceView`, never a `TextureView`.** A TextureView's SurfaceTexture is
 * consumed by the app's GL thread; at 240 fps it cannot drain, the queue backs up, and this HAL
 * leaks fences and triggers its own recovery — the app frozen mid-countdown with the camera dead
 * (2026-08-20). A SurfaceView's buffer queue goes straight to SurfaceFlinger and drops frames it
 * cannot show, which is what Samsung's own slow-motion mode and CameraX's PERFORMANCE preview both
 * rely on. The cost is that the picture cannot be matrix-transformed, so the centre-crop is done by
 * laying the child out larger than this view and letting the parent clip it (`onLayout`).
 *
 * **The buffer size is fixed ONCE, at open, to the size the take will record at.** Resizing a
 * preview surface to enter the constrained session tears the buffers down underneath the HAL; a
 * size mismatch between the two outputs is invalid outright. Deciding both at open means the
 * session swap changes only the shape of the session, never its surfaces.
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

    /** The rate the preview buffers are sized for at open. A `startRecording` ceiling below
     * this picks a slower RANGE at the same size, never a different size — see takeConfig. */
    const val MAX_USEFUL_FPS = 240

    /** The analyzer's own CV input short side (`video.py`) — below it we throw away detail
     * the pipeline would have used. */
    const val MIN_SHORT_SIDE = 720
  }

  /**
   * The one lock over camera + recorder state.
   *
   * Two threads touch this object and neither can be eliminated: the camera thread owns the
   * session and recorder lifecycle, while the OS delivers `surfaceDestroyed` /
   * `onDetachedFromWindow` on MAIN and can do so at any instant (screen off, app switch, a
   * Fast Refresh remount). `MediaRecorder` is not thread-safe, so a Stop racing a teardown
   * could call `stop()`/`release()` twice on the same native recorder — an exception the old
   * `runCatching` swallowed, or a double-free in mediaserver that it could not.
   *
   * Everything guarded here is listed in one place on purpose: `device`, `session`,
   * `recorder`, `recordFile`, `recordSurface`, `recording`, `takeInFlight`, `generation`.
   */
  private val cameraLock = Any()

  // -- State (declared before the init block that adds the SurfaceView; see class comment) --
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var previewSize: Size? = null
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
  @Volatile private var recording: Boolean = false

  /**
   * True from the moment a take begins configuring until it settles — a window `recording`
   * does NOT cover, because `recording` only turns true once the session is up. Anything that
   * would disturb the camera in that window (a zoom tick re-arming the preview's repeating
   * request) has to check this instead, or it re-creates the drain block that cost a day:
   * the device never idles, and session creation blocks ~11 s before failing.
   */
  @Volatile private var takeInFlight: Boolean = false

  /** Settles a take's promise if the camera is torn down mid-configure — see `closeCamera`. */
  private var pendingTakePromise: ((Result<Map<String, Any>>) -> Unit)? = null

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
  /**
   * What this lens will actually record at, published as soon as it is known — the PROBED
   * truth, never a request. The FPS pill renders this and nothing else: §2.3 forbids
   * degrading silently, so a lens that can only manage 120 must say 120 on screen.
   */
  private val onCaptureConfig by EventDispatcher()
  /**
   * Generation counter: a callback from a superseded open must not resurrect a session.
   *
   * Atomic because it is incremented from BOTH threads — main on open/close, the camera
   * thread on error-recovery reopen. A lost `++` lets a stale `onOpened` pass the guard and
   * assign `device` after teardown nulled it, which holds the camera until process death.
   */
  private val generation = AtomicInteger(0)

  private val surface = SurfaceView(context)

  /** Bounded error-recovery reopens (see openCamera's onError); reset on a good open. */
  private var reopenAttempts = 0

  /** An open is in flight. Guards the double-open that leaks a whole CameraDevice — see
   * `openCamera`. Written only under `cameraLock`. */
  private var opening = false

  /** The high-speed configuration this lens will record at, chosen once per open. The preview
   * buffer is fixed to `first` so entering the constrained session resizes nothing. */
  private var takeConfig: Pair<Size, List<Range<Int>>>? = null

  /** The buffer size last asked of the holder — the size `surfaceChanged` must report before
   * the camera may open. Distinct from `takeConfig` because a lens with no high-speed mode
   * still has a preview size. */
  private var wantedSize: Size? = null

  init {
    // The parent clips the oversized child — that IS the centre-crop; see onLayout.
    clipChildren = true
    addView(surface)
    surface.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        // Size the buffers BEFORE opening: the session is built on this surface, and a
        // resize afterwards pulls the buffers out from under the HAL.
        applyBufferSize(holder)
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
        val want = wantedSize ?: return
        // Only once the buffers are the size the session will use — surfaceChanged fires
        // first with the VIEW's size, before setFixedSize takes effect.
        if (w == want.width && h == want.height && device == null) openCamera()
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        closeCamera()
      }
    })
  }

  /**
   * Choose the lens's recording configuration and fix the preview buffers to it.
   *
   * Reading characteristics needs no open device, so this settles the size before the camera
   * is touched — the ordering that keeps the idle preview and the take on ONE unchanging
   * surface.
   */
  private fun applyBufferSize(holder: SurfaceHolder) {
    val id = cameraId() ?: run { Log.w(TAG, "no back camera"); return }
    val config = bestHighSpeed(id, MAX_USEFUL_FPS)
    takeConfig = config
    val size = config?.first
      // No high-speed configuration at all (the front lens, on most devices): the preview
      // still has to work, so fall back to an ordinary 16:9 output size. `startRecording`
      // refuses separately — it never silently degrades.
      ?: ordinaryPreviewSize(id)
    previewSize = size
    requestLayout()
    // `setFixedSize` only calls back when the size CHANGES. A flip between two lenses whose
    // chosen size is identical (both 1080p here) fires nothing, and the camera would never
    // reopen — the frozen preview after a camera flip, 2026-08-20.
    val unchanged = wantedSize == size && holder.surface?.isValid == true
    wantedSize = size
    holder.setFixedSize(size.width, size.height)
    if (unchanged) openCamera()

    // `highSpeed: false` is a real answer, not an error — the front lens is a framing aid and
    // the pill must say so rather than quoting a rate nothing will record at.
    onCaptureConfig(mapOf(
      "fps" to (config?.second?.firstOrNull()?.upper ?: 0),
      "width" to size.width,
      "height" to size.height,
      "highSpeed" to (config != null),
      // Every rate the golfer could actually pick: the FIXED ranges only, because those are
      // the only ones a take will run at (see TakeAttempt — a variable range is invalid with
      // a preview and dishonest without one). Highest first, ready for a picker.
      "rates" to (config?.second
        ?.filter { it.lower == it.upper }
        ?.map { it.upper }
        ?.distinct()
        ?.sortedDescending()
        ?: emptyList<Int>()),
    ))
  }

  fun setZoom(next: Float) {
    zoom = next
    if (!recording) applyZoom()
  }

  /** Expo's `OnViewDestroys` entry point — see the module definition. */
  fun releaseCamera() = closeCamera()

  override fun onDetachedFromWindow() {
    closeCamera()
    super.onDetachedFromWindow()
  }

  private val manager get() = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  /**
   * The back lens, always (Taylor, 2026-08-20 — the front camera is gone from the product).
   * High-speed configurations are a rear-sensor feature, so a front-facing capture could only
   * ever have been a framing aid, and carrying the lens choice cost a whole class of session
   * teardown bugs for a mode nothing could record with.
   */
  private fun cameraId(): String? = manager.cameraIdList.firstOrNull {
    manager.getCameraCharacteristics(it)
      .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
  }

  // ---------------------------------------------------------------- capabilities

  /**
   * The best high-speed configuration at or below `maxFps`, or null when the lens offers none.
   *
   * Rate first, then the LARGEST size at that rate. Smallest-≥720 was tried (the analyzer
   * downscales above 720 anyway) and 720p240+preview wedged this device's HAL — fence leak in
   * `RealTimePreviewVideoHFR`, recovery, frozen app. Samsung's own slow-motion records 1080p240
   * with a live preview, so the largest size is the configuration the OEM actually exercises,
   * and off the OEM path this HAL wedges rather than refuses (D38's lesson, again).
   */
  private fun bestHighSpeed(id: String, maxFps: Int): Pair<Size, List<Range<Int>>>? {
    val map = manager.getCameraCharacteristics(id)
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
    var bestSize: Size? = null
    var bestRate = 0
    for (size in map.highSpeedVideoSizes) {
      // The analyzer downscales to 720 on the short side before it computes a keypoint, so
      // anything below that is detail the pipeline WOULD have used, thrown away. Without a
      // floor, rate-first happily picks 480p@240 over 1080p@240 on a device that offers both.
      if (minOf(size.width, size.height) < MIN_SHORT_SIDE) continue
      for (range in map.getHighSpeedVideoFpsRangesFor(size)) {
        // FIXED ranges only, here as well as in the ladder. A size whose only qualifying
        // range is variable cannot record at all (see TakeAttempt), so letting it win the
        // size election produces an empty ladder while a usable size sat one entry away.
        if (range.lower != range.upper || range.upper > maxFps) continue
        val better = range.upper > bestRate ||
          (range.upper == bestRate && bestSize != null &&
            size.width * size.height > bestSize!!.width * bestSize!!.height)
        if (bestSize == null || better) {
          bestSize = size
          bestRate = maxOf(bestRate, range.upper)
        }
      }
    }
    val size = bestSize ?: return null
    // Every range this size offers, so a lower `startRecording` ceiling picks a slower rate at
    // the SAME size — the surfaces never have to change.
    return size to map.getHighSpeedVideoFpsRangesFor(size).sortedByDescending { it.upper }
  }

  /**
   * One configuration to attempt: a rate range, and whether the preview rides along.
   *
   * A device publishes BOTH a variable range and a fixed one at the same top rate — the S25+
   * offers 1080p `[30,240]` (batch 8) and `[240,240]` (batch 4) — and they are NOT
   * interchangeable. `CameraConstrainedHighSpeedCaptureSession`'s contract is explicit:
   *
   * > "If both preview and recording Surfaces are specified in the request, the target FPS
   * > range in the input request must be a fixed frame rate FPS range, where the minimal
   * > FPS == maximum FPS."
   *
   * The framework then interleaves the batch itself — preview is fed at ~30 fps while the
   * encoder takes all 240. Handing it the VARIABLE range with a preview attached is the
   * invalid combination, and this HAL answers invalid combinations with silence rather than
   * an exception (2026-08-20: every preview+record attempt hung, while record-only at the
   * fixed range measured 231 fps in D39). Both ranges report `upper == 240`, so sorting by
   * rate tie-breaks between valid and invalid arbitrarily — which is what this type ends.
   *
   * Variable ranges are not used at all: a rate that floats between 30 and 240 writes
   * timestamps that disagree with `setCaptureRate`, and a file whose frame timing lies is the
   * one outcome worse than failing (D37's amendment).
   */
  private data class TakeAttempt(
    val range: Range<Int>,
    val withPreview: Boolean,
  ) {
    val fps get() = range.upper
    /** For the log — the whole point is knowing WHICH configuration the device accepted. */
    override fun toString() = "${range.lower}-${range.upper}${if (withPreview) " +preview" else " record-only"}"
  }

  /**
   * The configurations to try, best first, for a requested ceiling.
   *
   * This is a LADDER, not a choice, because no amount of reading capability tables predicts
   * which shape a given HAL will actually run — this one accepts an invalid combination and
   * then never answers instead of refusing (D38, and every record attempt on 2026-08-20). So
   * the device is asked, in the order we would prefer, and the first configuration that
   * actually configures wins. The rate is never degraded silently: every rung at the top rate
   * is exhausted before a slower one is considered, and the resolved rate is what the FPS
   * pill shows.
   */
  private fun attemptLadder(ranges: List<Range<Int>>, maxFps: Int): List<TakeAttempt> =
    ranges
      // FIXED ranges only — see TakeAttempt. A variable range is invalid with a preview
      // attached and dishonest without one.
      .filter { it.lower == it.upper && it.upper <= maxFps }
      .sortedByDescending { it.upper }
      .flatMap {
        // Preview first at each rate, then record-only: the rate is never traded for the
        // viewfinder. 240 record-only beats 120 with a live picture, every time.
        listOf(TakeAttempt(it, withPreview = true), TakeAttempt(it, withPreview = false))
      }

  /** A plain preview size for a lens with no high-speed configuration — the front camera on
   * most devices. Largest 16:9 at or under 1080p: a viewfinder, not a capture format. */
  private fun ordinaryPreviewSize(id: String): Size =
    manager.getCameraCharacteristics(id)
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?.getOutputSizes(SurfaceHolder::class.java)
      ?.filter { it.width * 9 == it.height * 16 && it.height <= 1080 }
      ?.maxByOrNull { it.width * it.height }
      ?: Size(1920, 1080)

  /**
   * The rotation the MP4 header must carry so the clip plays the way it was filmed.
   *
   * The sensor is mounted landscape and hands the encoder landscape frames no matter how the
   * phone is held, so a portrait recording is only portrait because of this number. Nothing
   * was setting it: every take was written 1920x1080 with no rotation at all, and every
   * player — the review screen, the post-swing player, and eventually the analyzer, which
   * would have measured a golfer lying on their side — drew it on its edge (2026-08-21).
   *
   * Back lens only and the app is locked to portrait (`app.json`), so the device is always at
   * its natural rotation and the hint reduces to the sensor's own mounting angle. Read from
   * the device rather than written as 90: it is a per-sensor fact, not a constant.
   */
  private fun orientationHint(cameraId: String): Int =
    manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90

  private fun bitrateFor(size: Size, fps: Int): Int {
    val base = size.width.toDouble() * size.height.toDouble() * 30.0 * BPP_AT_30
    return (base * sqrt(fps.toDouble() / 30.0)).toInt().coerceAtMost(MAX_BITRATE)
  }

  // ---------------------------------------------------------------- open / preview

  @SuppressLint("MissingPermission") // JS gates mounting on the CAMERA grant.
  private fun openCamera() {
    // ONE open at a time. `applyBufferSize` and `surfaceChanged` can both decide to open on a
    // background→foreground return (the holder keeps its fixed size, so the recreated surface
    // already reports the wanted size while `device` is still null because the open is async).
    // Two opens leak a whole CameraDevice: the second quits the thread the first registered
    // its callback on, so that device's `onOpened` is never delivered and nobody ever closes
    // it — the camera is then held until the process dies.
    synchronized(cameraLock) {
      if (opening || device != null) return
      opening = true
    }
    val id = cameraId() ?: run {
      Log.w(TAG, "no back camera")
      synchronized(cameraLock) { opening = false }
      return
    }
    val gen = generation.incrementAndGet()
    // A reopen (error recovery) replaces the thread — quit the old one or every recovery
    // leaks a live HandlerThread.
    thread?.quitSafely()
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
    // `openCamera` can run on the camera thread (error recovery), and events cross to JS from
    // main — see the `post` in the cap listener.
    val range = mapOf("min" to zoomRange.first.toDouble(), "max" to zoomRange.second.toDouble())
    post { onZoomRange(range) }

    try {
      manager.openCamera(id, object : CameraDevice.StateCallback() {
        override fun onOpened(cam: CameraDevice) {
          synchronized(cameraLock) {
            opening = false
            if (gen != generation.get()) { cam.close(); return }
            reopenAttempts = 0
            device = cam
          }
          startPreview(cam, gen)
        }
        override fun onDisconnected(cam: CameraDevice) {
          cam.close()
          synchronized(cameraLock) {
            opening = false
            if (gen == generation.get()) device = null
          }
        }
        override fun onError(cam: CameraDevice, error: Int) {
          Log.w(TAG, "preview camera error $error")
          cam.close()
          val current = synchronized(cameraLock) {
            opening = false
            val mine = gen == generation.get()
            if (mine) device = null
            mine
          }
          // Only MY generation's error may end a take. A superseded device's late error
          // would otherwise tear down a recorder that is mid-swing on the new one.
          if (!current) return
          failRecording("camera error $error")
          // A fatal device error (4) or a wedged service leaves a DEAD device object; the
          // documented recovery is to reopen. Bounded so a genuinely broken camera does not
          // reopen-loop — two tries, then the golfer re-enters the screen to try again.
          if (reopenAttempts < 2) {
            reopenAttempts += 1
            Log.w(TAG, "reopening camera after error $error (attempt $reopenAttempts)")
            // To MAIN, not the camera thread: `openCamera` quits that thread, and a runnable
            // must not quit the looper it is running on.
            postDelayed({ if (gen == generation.get()) openCamera() }, 1_200)
          }
        }
      }, handler)
    } catch (e: Throwable) {
      synchronized(cameraLock) { opening = false }
      Log.w(TAG, "openCamera failed: ${e.message}")
    }
  }

  /**
   * The view's own Surface — ONE object for the view's whole life, owned by the SurfaceHolder
   * and already fixed to the take's size (`applyBufferSize`). Both session shapes and every
   * request target this exact instance: a second wrapper over the same buffer queue leaves
   * un-signalled fences behind, which is the HAL's "fences not cleared" wedge.
   */
  private fun previewSurface(): Surface? = surface.holder.surface?.takeIf { it.isValid }

  private fun startPreview(cam: CameraDevice, gen: Int) {
    val out = previewSurface() ?: return
    try {
      @Suppress("DEPRECATION") // Consistent with the recording path; see the class comment.
      cam.createCaptureSession(listOf(out), object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
          // A superseded session is STOPPED, never closed: `close()` forces a pipeline drain
          // this HAL times out on for ~11 s, and it would block the camera thread while a
          // take runs. The next session creation (or the device close) reclaims it.
          if (gen != generation.get()) { runCatching { s.stopRepeating() }; return }
          synchronized(cameraLock) { session = s }
          applyZoom()
        }
        override fun onConfigureFailed(s: CameraCaptureSession) {
          // Terminal and silent was the old behaviour: a refused preview left a black
          // viewfinder with nothing said. One bounded reopen, then tell JS.
          Log.w(TAG, "preview session refused")
          if (gen != generation.get()) return
          if (reopenAttempts < 2) {
            reopenAttempts += 1
            postDelayed({ if (gen == generation.get()) { closeCamera(); openCamera() } }, 600)
          } else {
            post { onRecordingEnded(mapOf("reason" to "error", "error" to "the camera would not start a preview")) }
          }
        }
      }, handler)
    } catch (e: Throwable) {
      Log.w(TAG, "createCaptureSession failed: ${e.message}")
    }
  }

  /**
   * (Re)issues the repeating request — also how a zoom change lands without a new session.
   *
   * Always on the camera thread, and never while a take is being set up. A zoom tick landing
   * between `stopRepeating()` and `createConstrainedHighSpeedCaptureSession` re-arms the
   * preview, so the device never idles and session creation blocks ~11 s before failing with
   * "Error waiting to drain" — the exact wedge this file was rewritten to eliminate. Note the
   * guard is `takeInFlight`, NOT `recording`: `recording` only turns true after the session
   * configures, leaving the whole configure window unguarded.
   */
  private fun applyZoom() {
    val h = handler ?: return
    if (Looper.myLooper() != h.looper) {
      h.post { applyZoom() }
      return
    }
    if (takeInFlight || recording) return
    val cam = device ?: return
    val s = synchronized(cameraLock) { session } ?: return
    try {
      val request = cam.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
        // The holder's own Surface, never a second wrapper — see previewSurface().
        addTarget(previewSurface() ?: return)
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
    val h = handler ?: return promise(Result.failure(IllegalStateException("no camera thread")))
    // EVERYTHING below runs on the camera thread. Expo dispatches a VIEW AsyncFunction on the
    // MAIN thread, and `MediaRecorder.prepare()` — like `stop()` — blocks for hundreds of
    // milliseconds. On the main thread that is a frozen screen with a dead Stop button, which
    // is exactly how the record freeze presented (2026-08-20).
    // Remembered so a teardown mid-configure can settle it. Without this, a camera thread
    // quit while a take was still configuring left the promise dangling forever: JS awaited
    // `startRecording` that never resolved OR rejected, and the screen sat on "Recording…"
    // with no way out.
    takeInFlight = true
    pendingTakePromise = promise
    val settleOwned = fun(result: Result<Map<String, Any>>) {
      val p = synchronized(cameraLock) {
        val held = pendingTakePromise
        pendingTakePromise = null
        takeInFlight = false
        held
      }
      p?.invoke(result)
    }

    val posted = h.post {
      // The size was fixed at open and the preview buffers are already it
      // (`applyBufferSize`); the ceiling only chooses among the RATES that size offers.
      val config = takeConfig
      if (config == null) {
        settleOwned(Result.failure(IllegalStateException(
          "this camera offers no high-speed configuration"
        )))
        return@post
      }
      val ladder = attemptLadder(config.second, maxFps)
      if (ladder.isEmpty()) {
        settleOwned(Result.failure(IllegalStateException(
          "this camera offers no high-speed rate at or below ${maxFps}fps"
        )))
        return@post
      }
      Log.i(TAG, "take ladder: ${ladder.joinToString(" -> ")}")
      beginTake(config.first, ladder, 0, maxSeconds, h, settleOwned)
    }
    // `Handler.post` to a quit looper returns false and drops the runnable silently — the
    // other half of the never-settling promise.
    if (!posted) settleOwned(Result.failure(IllegalStateException("the camera was shut down")))
  }

  /**
   * Try `ladder[rung]`; on silence or refusal, move to the next rung.
   *
   * Every rung is a real question to the HAL rather than a prediction about it, because this
   * class of device answers an unsupported combination with silence — no `onConfigured`, no
   * `onConfigureFailed` — and leaks fences until it triggers its own recovery (D38, and every
   * record attempt on 2026-08-20). The watchdog turns that silence into the next rung, and the
   * log names the configuration that finally ran.
   */
  @SuppressLint("MissingPermission")
  private fun beginTake(
    size: Size,
    ladder: List<TakeAttempt>,
    rung: Int,
    maxSeconds: Int,
    h: Handler,
    promise: (Result<Map<String, Any>>) -> Unit,
  ) {
    // A take still running when JS asks to start one is an ORPHAN: the screen no longer knows
    // about it, so nothing will ever stop it and every future Record fails with "already
    // recording" until the app is killed. It happened for real when a Fast Refresh remounted
    // the screen mid-take (2026-08-21). Refusing here protects a recording nobody can reach;
    // abandoning it is what lets the golfer keep filming, so native never says no to Record.
    abandonOrphanedTake()
    // Every early return from here on restores the preview. Without it the golfer is left
    // staring at a black viewfinder: `abandonOrphanedTake` deliberately does not rebuild a
    // session, on the promise that the caller is about to — and these paths never did.
    val cam = device ?: run {
      restorePreview()
      return promise(Result.failure(IllegalStateException("camera is not open")))
    }
    val attempt = ladder.getOrNull(rung) ?: run {
      restorePreview()
      return promise(Result.failure(IllegalStateException(
        "the camera would not start a high-speed session in any supported configuration"
      )))
    }
    val range = attempt.range
    val fps = attempt.fps
    val previewLive = attempt.withPreview

    val file = File(context.cacheDir, "swing_${fps}fps_${System.currentTimeMillis()}.mp4")
    // Built into a named local FIRST, so a throw from any setter or from `prepare()` can
    // still release it. Configured inside `apply` on an unnamed receiver, a failure left the
    // native recorder and its input Surface unreachable and unreleased — a handful of those
    // exhausts mediaserver's recorder slots and every later take fails device-wide.
    val rec = MediaRecorder(context)
    try {
      rec.apply {
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
        // The one line that makes a portrait swing play portrait — see `orientationHint`.
        setOrientationHint(orientationHint(cam.id))
        setMaxDuration(maxSeconds * 1000)
        setOnInfoListener { _, what, _ ->
          if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
            // The recorder has already finalised the file; settle the same way a tap would.
            val result = settleRecording()
            val payload = result.getOrNull()?.plus("reason" to "cap")
              ?: mapOf("reason" to "error", "error" to (result.exceptionOrNull()?.message ?: "unknown"))
            // Events cross to JS from the MAIN thread. Expo's dispatcher walks the module
            // registry and mutates non-volatile state with no hop of its own; this listener
            // runs on the camera thread, so the hop is ours to make.
            post { onRecordingEnded(payload) }
          }
        }
        prepare()
      }
    } catch (e: Throwable) {
      runCatching { rec.release() }
      runCatching { file.delete() }
      // A rejected encoder configuration is THIS rung failing, not the device refusing
      // outright — the next rung (a lower rate, or record-only) may well be accepted, so the
      // ladder gets its turn instead of the golfer getting an error.
      Log.w(TAG, "rung $rung ($attempt) recorder setup threw: ${e.message}")
      return if (rung + 1 < ladder.size) {
        beginTake(size, ladder, rung + 1, maxSeconds, h, promise)
      } else {
        restorePreview()
        promise(Result.failure(e))
      }
    }

    val recSurface = rec.surface
    // Already the take's size, already the session's surface — nothing to resize or rewrap.
    val preview = if (previewLive) previewSurface() else null
    if (previewLive && preview == null) {
      runCatching { rec.reset(); rec.release() }
      runCatching { file.delete() }
      restorePreview()
      return promise(Result.failure(IllegalStateException("preview surface is gone")))
    }
    val targets = listOfNotNull(preview, recSurface)

    synchronized(cameraLock) {
      recorder = rec
      recordFile = file
      recordSurface = recSurface
    }
    achievedFps = fps

    // STOP THE OLD REQUEST FIRST. Creating a session waits for the device to go idle, and a
    // repeating request left running never lets it — the create blocks ~11 s and then fails
    // with "Error waiting to drain", which is what every record attempt did on 2026-08-20.
    // `stopRepeating()` is what makes the device idle; `close()` is the heavier hammer that
    // forces a full drain and times out on this HAL, so it is deliberately not used here.
    synchronized(cameraLock) {
      runCatching { session?.stopRepeating() }
      session = null
    }

    Log.i(TAG, "take rung $rung: ${size.width}x${size.height} @ $attempt, " +
      "cap ${maxSeconds}s, ${bitrateFor(size, fps)}bps")

    // This HAL's failure mode of choice is a session that never configures (it wedges rather
    // than refuses — D38, and the 2026-08-20 fence-leak freeze). First answer wins.
    //
    // Atomic, not a captured `var`: every current path happens to reach this on `h`, which
    // made a plain boolean safe by accident. That is an invariant nothing enforced, and one
    // future hop off `h` would have turned it into a double-settled promise (a bridge crash).
    val settled = AtomicBoolean(false)
    val settleOnce = fun(action: () -> Unit) {
      if (settled.getAndSet(true)) return
      action()
    }

    /** Silence or refusal at this rung — clean up and ask the device the next question. */
    val fallBackOrFail = fun(why: String) {
      settleOnce {
        Log.w(TAG, "rung $rung ($attempt) $why")
        teardownRecorder()
        if (rung + 1 < ladder.size) {
          beginTake(size, ladder, rung + 1, maxSeconds, h, promise)
        } else {
          promise(Result.failure(IllegalStateException(
            "the camera would not start a high-speed session in any supported configuration"
          )))
          restorePreview()
        }
      }
    }

    // The watchdog runs on the MAIN handler, never on `h`. Creating a session blocks the
    // camera thread — for eleven seconds when the device will not idle — so a watchdog posted
    // to `h` sits in the queue behind the very call it exists to time out, and fires only
    // after the thing it was guarding has already failed (2026-08-20: it never fired at all).
    // 4s, not 8: with a fallback behind it the ladder must not keep the golfer waiting
    // through two full timeouts before anything records.
    val watchdog = Runnable {
      // `post` returns false on a quit looper — the take is already over in that case, and
      // the promise was settled by `closeCamera`.
      if (!h.post { fallBackOrFail("never configured — watchdog fired") }) {
        Log.w(TAG, "watchdog could not reach the camera thread — it is gone")
      }
    }
    postDelayed(watchdog, 4_000)

    try {
      @Suppress("DEPRECATION") // The modern overload is swallowed on this device; see the class comment.
      cam.createConstrainedHighSpeedCaptureSession(
        targets,
        object : CameraCaptureSession.StateCallback() {
          override fun onConfigured(s: CameraCaptureSession) {
            // A late answer from a rung the ladder already gave up on. STOP it, never
            // `close()` — close forces a drain this HAL takes ~11 s to fail, and it would
            // block the camera thread while the winning rung is mid-take, which is a Stop
            // button that does nothing for eleven seconds.
            if (settled.get()) { runCatching { s.stopRepeating() }; return }
            try {
              synchronized(cameraLock) { session = s }
              val highSpeed = s as CameraConstrainedHighSpeedCaptureSession
              val request = cam.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                // Every session target, and only session targets — a constrained session
                // rejects a request that does not cover exactly what it was configured with.
                targets.forEach { addTarget(it) }
                set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                // NOTHING else. `createHighSpeedRequestList` accepts a restricted key set, and
                // a key outside it is another silent-misbehaviour risk on this HAL — Samsung's
                // own slow-motion offers no zoom while recording either. The framing the
                // golfer set still applies: zoom is a sensor crop that persists across the
                // session swap.
              }.build()
              // ENCODER FIRST, THEN FRAMES. `MediaRecorder.start()` takes 100-300 ms to spin
              // its encoder up, and until it does nothing dequeues buffers from the recorder
              // surface. Start the burst first and the camera pumps 240 fps into a surface
              // that cannot return buffers: the HAL runs out, its fences never clear, and it
              // triggers its own recovery — measured at reqId 34, which is ~140 ms at 240 fps,
              // exactly the encoder's start-up window (2026-08-20). At 30 fps the same bug
              // takes a second to bite and nobody notices; at 240 it is instant.
              rec.start()
              // Mandatory: a constrained session rejects a plain repeating request, because the
              // frames are delivered in batches.
              highSpeed.setRepeatingBurst(highSpeed.createHighSpeedRequestList(request), null, h)
              settleOnce {
                // The watchdog has nothing left to guard — cancel it rather than leaving a
                // no-op to fire into a running take.
                removeCallbacks(watchdog)
                recording = true
                recordStartedAtMs = System.currentTimeMillis()
                Log.i(TAG, "take RUNNING on rung $rung ($attempt)")
                promise(Result.success(mapOf(
                  "fps" to fps,
                  "width" to size.width,
                  "height" to size.height,
                  "maxSeconds" to maxSeconds,
                  // The screen must not claim a live picture it is not showing.
                  "previewLive" to previewLive,
                  // The take's real start, for a countdown that must not drift from the
                  // recorder's own cap (JS timed it from the mode change and ran early).
                  "startedAtMs" to recordStartedAtMs,
                )))
              }
            } catch (e: Throwable) {
              // A throw here is this configuration failing, not the device refusing outright —
              // the ladder gets its turn before the golfer sees an error.
              Log.w(TAG, "high-speed start threw: ${e.message}")
              fallBackOrFail("threw at start: ${e.message}")
            }
          }

          override fun onConfigureFailed(s: CameraCaptureSession) {
            fallBackOrFail("REFUSED at ${size.width}x${size.height}@$fps")
          }
        },
        h,
      )
    } catch (e: Throwable) {
      fallBackOrFail("threw at create: ${e.message}")
    }
  }

  /** Stop by tap. The cap path settles through `setOnInfoListener` instead, never through here. */
  fun stopRecording(promise: (Result<Map<String, Any>>) -> Unit) {
    // Off the main thread for the same reason as the start — `MediaRecorder.stop()` blocks,
    // and a Stop button that freezes the app is worse than no Stop button.
    val h = handler ?: return promise(Result.failure(IllegalStateException("no camera thread")))
    h.post {
      if (!recording) promise(Result.failure(IllegalStateException("not recording")))
      else promise(settleRecording())
    }
  }

  /**
   * The one place a take ends: stop the burst, stop the recorder, hand back the file, go back to
   * preview. Both endings (tap, cap) route through here so they cannot diverge.
   *
   * A `MediaRecorder.stop()` that throws means the take was too short to produce a valid MP4 —
   * a real outcome (a double-tap), reported rather than left as a zero-byte file.
   */
  private fun settleRecording(): Result<Map<String, Any>> {
    // The whole stop is one critical section: a `surfaceDestroyed` on main racing this would
    // otherwise call `stop()`/`release()` on the same native recorder from two threads.
    val stopped: Result<Unit?>
    val file: File?
    val durationMs: Long
    synchronized(cameraLock) {
      if (!recording) return Result.failure(IllegalStateException("not recording"))
      recording = false
      file = recordFile
      recordFile = null
      durationMs = System.currentTimeMillis() - recordStartedAtMs

      // Frames off BEFORE the encoder stops — the mirror of the start order. Stopping the
      // encoder first leaves the camera pumping into a surface nothing drains.
      runCatching { (session as? CameraConstrainedHighSpeedCaptureSession)?.stopRepeating() }
      stopped = runCatching { recorder?.stop() }
      teardownRecorder()
    }
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

  /**
   * Tear down a take nothing is going to claim, keeping the camera usable.
   *
   * The file goes with it: JS never learned this take existed, so it can never be reviewed,
   * and leaving it in the cache is a swing-sized file nobody will ever delete. No
   * `restorePreview()` — the caller is about to build its own session.
   */
  private fun abandonOrphanedTake() {
    synchronized(cameraLock) {
      if (!recording) return
      Log.w(TAG, "start requested while a take was running — abandoning the orphan")
      recording = false
      runCatching { (session as? CameraConstrainedHighSpeedCaptureSession)?.stopRepeating() }
      // The stopped session must not be left behind for `restorePreview` to stop a second
      // time — the next session creation is what reclaims it.
      session = null
      runCatching { recorder?.stop() }
      teardownRecorder()
      runCatching { recordFile?.delete() }
      recordFile = null
    }
  }

  /** Camera died mid-take: end it as a reported failure rather than a screen that never moves. */
  private fun failRecording(reason: String) {
    synchronized(cameraLock) {
      if (!recording) return
      recording = false
      runCatching { recorder?.stop() }
      teardownRecorder()
      // The half-written file is unplayable and nobody will ever see it — do not leave a
      // swing-sized orphan in the cache.
      runCatching { recordFile?.delete() }
      recordFile = null
    }
    post { onRecordingEnded(mapOf("reason" to "error", "error" to reason)) }
  }

  /** Caller holds `cameraLock`. */
  private fun teardownRecorder() {
    runCatching { recorder?.reset(); recorder?.release() }
    recorder = null
    // The Surface belongs to the MediaRecorder, which just released it — releasing it again
    // here is at best a no-op and on some ROMs a double-free of the input surface.
    recordSurface = null
  }

  /** Back to the idle repeating preview after a take, so the next swing can be framed. */
  private fun restorePreview() {
    val cam = synchronized(cameraLock) {
      // Same rule as entering the take: stop the burst so the device can idle, then build the
      // next session. Not close() — that forces the drain this HAL times out on.
      runCatching { session?.stopRepeating() }
      session = null
      device
    } ?: return
    startPreview(cam, generation.get())
  }

  // ---------------------------------------------------------------- teardown

  /**
   * Centre-crop, by LAYOUT rather than by matrix: a SurfaceView's picture cannot be
   * transformed, so the child is laid out large enough to fill this view on both axes,
   * centred, and the parent clips the overflow. Preserving the aspect is the point — a
   * stretched golfer is a wrong picture, not a cosmetic one.
   */
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val viewW = r - l
    val viewH = b - t
    if (viewW <= 0 || viewH <= 0) return
    val size = previewSize
    if (size == null) {
      surface.layout(0, 0, viewW, viewH)
      return
    }
    // Portrait-locked app: the sensor buffer is landscape and displays rotated, so its
    // on-screen width:height is the buffer's height:width.
    val displayedAspect = size.height.toFloat() / size.width.toFloat()
    val childW: Int
    val childH: Int
    if (viewW < viewH * displayedAspect) {
      childH = viewH
      childW = (viewH * displayedAspect).toInt()
    } else {
      childW = viewW
      childH = (viewW / displayedAspect).toInt()
    }
    val x = (viewW - childW) / 2
    val y = (viewH - childH) / 2
    surface.layout(x, y, x + childW, y + childH)
  }

  /**
   * Release everything, from whichever thread the OS chose.
   *
   * This runs on MAIN (`surfaceDestroyed`, `onDetachedFromWindow`, `OnViewDestroys`) while the
   * camera thread may be mid-take, so the recorder work is done under `cameraLock` — two
   * threads calling `stop()`/`release()` on one `MediaRecorder` is an exception at best and a
   * native double-free at worst.
   *
   * A take finalised here is REPORTED, never silently dropped: the file is real and it is the
   * golfer's only copy, so JS hears about it through `onRecordingEnded` and can review it.
   * Previously the MP4 was written and abandoned with no path in JS, and the reducer sat in
   * `recording` forever — the swing was lost and Record never worked again.
   */
  private fun closeCamera() {
    generation.incrementAndGet()
    var ending: Map<String, Any>? = null
    val orphaned = synchronized(cameraLock) {
      opening = false
      val was = recording
      val file = recordFile
      if (was) {
        recording = false
        val durationMs = System.currentTimeMillis() - recordStartedAtMs
        val stopped = runCatching { recorder?.stop() }
        recordFile = null
        if (stopped.isSuccess && file != null && file.exists() && file.length() > 0L) {
          ending = mapOf(
            "reason" to "cap",
            "path" to file.absolutePath,
            "fps" to achievedFps,
            "durationMs" to durationMs,
            "bytes" to file.length(),
          )
        } else {
          runCatching { file?.delete() }
          ending = mapOf("reason" to "error", "error" to "the recording was interrupted")
        }
      }
      teardownRecorder()
      // No explicit session close — closing the DEVICE abandons its sessions, while
      // `CameraCaptureSession.close()` forces a pipeline drain this device times out on
      // ("Error waiting to drain", then a fatal device error on the next open).
      session = null
      // The Surface belongs to the holder, not to us — releasing it here would destroy the
      // view's own picture. The holder tears it down in surfaceDestroyed.
      runCatching { device?.close() }
      device = null
      was
    }
    // A take still CONFIGURING when the camera went away: settle its promise, or JS awaits a
    // `startRecording` that resolves neither way and the screen never leaves "Recording…".
    val pending = synchronized(cameraLock) {
      val p = pendingTakePromise
      pendingTakePromise = null
      takeInFlight = false
      p
    }
    pending?.invoke(Result.failure(IllegalStateException("the camera was shut down")))
    ending?.let { payload -> post { onRecordingEnded(payload) } }
    if (orphaned) Log.w(TAG, "camera closed mid-take — the take was finalised and reported")

    thread?.quitSafely()
    thread = null
    handler = null
  }
}
