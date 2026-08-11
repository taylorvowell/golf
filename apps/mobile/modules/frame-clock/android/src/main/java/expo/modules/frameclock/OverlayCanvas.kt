package expo.modules.frameclock

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.Choreographer
import android.view.View

/**
 * Strategy C: the overlay drawn natively, from geometry handed over once.
 *
 * The insight this tests is specific to this product. The web player needs
 * `requestVideoFrameCallback` because a browser cannot give the compositor the overlay ahead of
 * time. We can: `analysis.json` contains every keypoint for every frame *before playback starts*.
 * So the per-frame journey through JavaScript — which strategy A pays about four frames for — is
 * not a requirement of the problem, it is a consequence of one implementation of it.
 *
 * Push the whole array over once, and the code that already knows which frame is on the glass
 * draws that frame's skeleton in the same vsync. There is no bridge in the per-frame path and
 * therefore nothing to drift. The per-frame callback stops being the mechanism and becomes only
 * the verification.
 *
 * **Zero drift here is by construction, not by measurement, and that distinction must be kept.**
 * Asking this class to score itself would be circular — it would compare the frame it just drew
 * against the frame it asked for and always agree. The honest judge is
 * `scripts/measure_overlay.py`, which reads the drawn marker and the burned-in bar out of the
 * same screenshot and does not know or care which strategy produced the pixels.
 */
class OverlayCanvas(context: Context) : View(context) {

  /** Flat keypoints: frame-major, `kpPerFrame` points each, 3 floats per point (x, y, conf). */
  private var kp: FloatArray = FloatArray(0)
  private var kpPerFrame: Int = 0

  /** Bone endpoints as keypoint-index pairs, and one ARGB colour per bone. */
  private var bones: IntArray = IntArray(0)
  private var boneColors: IntArray = IntArray(0)

  /** One ARGB colour per keypoint; a fully transparent entry means "no dot for this joint". */
  private var jointColors: IntArray = IntArray(0)

  /** Rendering gate. Zero is the analyzer's sentinel for a point it never located. */
  private var drawnConf: Float = 0f

  /** Supplies the frame currently on screen. Owned by FrameClockView, which times the video. */
  var frameProvider: (() -> Int)? = null

  private var running = false

  private val bonePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
  }
  private val jointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

  private val ticker = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!running) return
      // Redraw every vsync. The overlay and the video frame are then composited into the same
      // screen update, which is the whole point — drawing on a timer of our own would reintroduce
      // exactly the scheduling gap this strategy exists to remove.
      invalidate()
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  fun setGeometry(
    keypoints: FloatArray,
    perFrame: Int,
    boneIndices: IntArray,
    boneArgb: IntArray,
    jointArgb: IntArray,
    minConf: Float
  ) {
    kp = keypoints
    kpPerFrame = perFrame
    bones = boneIndices
    boneColors = boneArgb
    jointColors = jointArgb
    drawnConf = minConf
    invalidate()
  }

  fun start() {
    if (running) return
    running = true
    Choreographer.getInstance().postFrameCallback(ticker)
  }

  fun stop() {
    running = false
    Choreographer.getInstance().removeFrameCallback(ticker)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val perFrame = kpPerFrame
    if (perFrame == 0 || kp.isEmpty()) return

    val frame = frameProvider?.invoke() ?: -1
    if (frame < 0) return

    val base = frame * perFrame * 3
    // A frame beyond the supplied geometry draws NOTHING rather than the nearest one it has.
    // Drawing frame 301's skeleton on frame 300 is the defect the whole frame-sync effort exists
    // to prevent, and silently clamping here would reintroduce it in native code where it is far
    // harder to notice.
    if (base < 0 || base + perFrame * 3 > kp.size) return

    val w = width.toFloat()
    val h = height.toFloat()
    bonePaint.strokeWidth = maxOf(2f, w / 320f)
    val r = maxOf(3f, w / 190f)

    var i = 0
    while (i < bones.size) {
      val a = bones[i]
      val b = bones[i + 1]
      val ai = base + a * 3
      val bi = base + b * 3
      if (kp[ai + 2] > drawnConf && kp[bi + 2] > drawnConf) {
        bonePaint.color = boneColors[i / 2]
        canvas.drawLine(kp[ai] * w, kp[ai + 1] * h, kp[bi] * w, kp[bi + 1] * h, bonePaint)
      }
      i += 2
    }

    for (j in 0 until perFrame) {
      val c = jointColors.getOrNull(j) ?: 0
      if (c == 0) continue // transparent = hidden joint, matching the client's HIDE_JOINT rule
      val p = base + j * 3
      if (kp[p + 2] <= drawnConf) continue
      jointPaint.color = c
      canvas.drawCircle(kp[p] * w, kp[p + 1] * h, r, jointPaint)
    }
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }
}
