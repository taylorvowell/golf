import Foundation

/// Swift twin of the Kotlin `FrameStats`. Kept deliberately identical, including the nearest-rank
/// percentile, so an iOS number and an Android number in `decisions/` are the same measurement
/// and can be compared directly. If one side ever starts interpolating percentiles, the two
/// columns of that table quietly stop meaning the same thing.
final class FrameStats {
  private var samples: [Double] = []
  private let capacity: Int

  init(capacity: Int = 20_000) {
    self.capacity = capacity
  }

  func add(_ value: Double) {
    if samples.count < capacity { samples.append(value) }
  }

  func reset() { samples.removeAll(keepingCapacity: true) }

  var count: Int { samples.count }

  /// Nearest-rank: every value returned is one that was actually observed. A drift of "1.5
  /// frames" never happened and should never appear in a result table.
  func percentile(_ p: Double) -> Double {
    if samples.isEmpty { return 0 }
    let sorted = samples.sorted()
    let rank = min(max(Int(ceil(p / 100.0 * Double(sorted.count))), 1), sorted.count)
    return sorted[rank - 1]
  }

  func maxValue() -> Double { samples.max() ?? 0 }

  func mean() -> Double { samples.isEmpty ? 0 : samples.reduce(0, +) / Double(samples.count) }

  /// Share of samples that are exactly zero — the only outcome that counts as "locked".
  func exactShare() -> Double {
    if samples.isEmpty { return 0 }
    return Double(samples.filter { $0 == 0 }.count) / Double(samples.count)
  }

  func toDictionary() -> [String: Any] {
    [
      "count": count,
      "mean": mean(),
      "p50": percentile(50),
      "p95": percentile(95),
      "max": maxValue(),
      "exactShare": exactShare()
    ]
  }
}

/// Mirrors the web player's `frame = round(currentTime * fps)`, including the rounding.
func frameIndex(seconds: Double, fps: Double) -> Int {
  fps <= 0 ? 0 : Int((seconds * fps).rounded())
}

/// Mirrors the web player's `(frame + 0.5) / fps` — aiming at the middle of the frame's display
/// interval so floating-point representation cannot decide between frame N and N-1.
func seekTargetSeconds(frame: Int, fps: Double) -> Double {
  fps <= 0 ? 0 : (Double(frame) + 0.5) / fps
}
