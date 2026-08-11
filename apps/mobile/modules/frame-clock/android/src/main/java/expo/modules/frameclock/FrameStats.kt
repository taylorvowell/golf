package expo.modules.frameclock

import kotlin.math.roundToInt

/**
 * Sample accumulation for the step 02 spike, kept off the platform classes so the arithmetic can
 * be reasoned about (and ported) without an emulator.
 *
 * Deliberately stores every sample rather than a running summary. The spike's question is not
 * "what is the average drift" — an average hides exactly the pathology we are looking for, a
 * mostly-perfect overlay that slips several frames a few times a second. p95 and max are the
 * numbers that decide whether the framework choice holds, and both need the distribution.
 */
class FrameStats(private val capacity: Int = 20_000) {
  private val samples = ArrayList<Double>(1024)

  fun add(value: Double) {
    if (samples.size < capacity) samples.add(value)
  }

  fun reset() = samples.clear()

  val count: Int get() = samples.size

  /**
   * Nearest-rank percentile on the sorted samples.
   *
   * Nearest-rank rather than an interpolating variant on purpose: every sample here is a frame
   * count or a millisecond reading, and an interpolated "1.5 frames of drift" is not a thing that
   * happened. Every number this returns is a value that was actually observed.
   */
  fun percentile(p: Double): Double {
    if (samples.isEmpty()) return 0.0
    val sorted = samples.sorted()
    val rank = Math.ceil(p / 100.0 * sorted.size).toInt().coerceIn(1, sorted.size)
    return sorted[rank - 1]
  }

  fun max(): Double = samples.maxOrNull() ?: 0.0

  fun mean(): Double = if (samples.isEmpty()) 0.0 else samples.sum() / samples.size

  /** Share of samples that are exactly zero — the only outcome that counts as "locked". */
  fun exactShare(): Double {
    if (samples.isEmpty()) return 0.0
    return samples.count { it == 0.0 }.toDouble() / samples.size
  }

  fun toMap(): Map<String, Any> = mapOf(
    "count" to count,
    "mean" to mean(),
    "p50" to percentile(50.0),
    "p95" to percentile(95.0),
    "max" to max(),
    "exactShare" to exactShare()
  )
}

/**
 * Frame index from a presentation timestamp.
 *
 * Mirrors the web player's `frame = round(currentTime * fps)` exactly — including the rounding —
 * because a mobile client that indexes frames differently from the analyzer would draw the right
 * skeleton on the wrong frame, which is the single defect this project treats as the #1 perceived
 * quality failure. Stage 0 normalizes every clip to CFR, so this is exact rather than approximate.
 */
fun frameIndexOf(presentationTimeUs: Long, fps: Double): Int =
  if (fps <= 0.0) 0 else (presentationTimeUs / 1_000_000.0 * fps).roundToInt()

/**
 * Seek target for a frame, in milliseconds.
 *
 * The half-frame offset is not cosmetic: seeking to exactly `frame / fps` lands on a boundary
 * where floating-point representation decides whether the decoder yields frame N or N-1. Aiming
 * at the middle of the frame's display interval removes the ambiguity. Same rule as the web
 * player's `(frame + 0.5) / fps`.
 */
fun seekTargetMs(frame: Int, fps: Double): Long =
  if (fps <= 0.0) 0L else ((frame + 0.5) / fps * 1000.0).toLong()
