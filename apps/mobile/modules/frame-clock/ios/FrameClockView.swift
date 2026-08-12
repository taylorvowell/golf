import AVFoundation
import ExpoModulesCore

/// iOS half of the step 02 measuring instrument. Same closed loop as the Android view, same
/// recorded quantities, so the two platforms produce comparable numbers.
///
/// Step 01 named this path — `AVPlayerItemVideoOutput` + `CADisplayLink` — as the confirmed iOS
/// analogue of `requestVideoFrameCallback`. `CADisplayLink.targetTimestamp` is the key to it: it
/// is the host time of the *next* vsync, so asking the video output which item time corresponds
/// to that instant tells us the frame that is about to be on the glass, not the one that just
/// left it.
class FrameClockView: ExpoView {
  private let onFrameRendered = EventDispatcher()
  private let onReady = EventDispatcher()
  private let onPlayerError = EventDispatcher()

  private let player = AVPlayer()
  private let playerLayer = AVPlayerLayer()
  private var videoOutput: AVPlayerItemVideoOutput?
  private var displayLink: CADisplayLink?
  private var statusObservation: NSKeyValueObservation?

  /// Supplied by JS, matching how the web player takes fps from `analysis.json`. See the Kotlin
  /// counterpart for why this must not be inferred from the container independently.
  var fps: Double = 60.0

  /// 60 events/sec is a measurement mode, not a playback mode.
  var emitFrames: Bool = false

  /// Frames handed to the layer but scheduled to appear at a FUTURE vsync. See the Kotlin
  /// counterpart for why this exists: scoring the overlay against the newest callback rather than
  /// against what is actually on screen inflates drift by the callback's lead time, and on the
  /// first real Android run that bias was the entire result. `CADisplayLink.targetTimestamp` is
  /// the *next* vsync, so iOS has the same bias in smaller form — one refresh interval, which is
  /// 8ms on the 120Hz panels this product targets.
  private var scheduled: [(frame: Int, displayAt: CFTimeInterval)] = []

  /// The newest frame the display link has identified. Not on screen yet.
  private var queuedFrame: Int = -1
  private var pendingSeekFrame: Int?
  private var lastEmittedFrame: Int = -1

  private let overlayDrift = FrameStats()
  /// Milliseconds of LEAD — positive means JS heard about the frame before it was due on screen.
  private let leadTimeMs = FrameStats()
  private let seekError = FrameStats()

  /// The frame actually on screen: the newest whose scheduled display time has already passed.
  private func onScreenFrame() -> Int {
    let now = CACurrentMediaTime()
    var current = -1
    var idx = 0
    while idx < scheduled.count, scheduled[idx].displayAt <= now {
      current = scheduled[idx].frame
      idx += 1
    }
    if idx > 0 { scheduled.removeFirst(idx) }
    if current >= 0 { scheduled.insert((frame: current, displayAt: now), at: 0) }
    return current
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspect
    layer.addSublayer(playerLayer)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    playerLayer.frame = bounds
  }

  private var sourceUri: String?
  private var sourceHeaders: [String: String] = [:]
  /// What is currently prepared, so re-applying identical props does not restart playback.
  private var appliedSource: String?

  func setSource(_ uri: String?) {
    sourceUri = uri
  }

  /// The headers every media request carries — in practice `Authorization` and the client version.
  ///
  /// **Unverified.** There is no Mac and no iOS device (D31); this is parity with the Android path
  /// that was measured, not a tested claim.
  func setHeaders(_ headers: [String: String]) {
    sourceHeaders = headers
  }

  /// Prepare the player, once, after every prop in the batch has been applied.
  ///
  /// The setters above deliberately only record. Props arrive in whatever order the view receives
  /// them, so building the asset inside `setSource` would fetch with whatever headers happened to
  /// have landed — none, on the pass where `source` comes first. See the Android counterpart; the
  /// failure mode there is a 404 that self-heals on the next apply, which is worse than one that
  /// does not.
  func applySource() {
    stopDisplayLink()
    statusObservation = nil

    guard let uri = sourceUri, !uri.isEmpty, let url = URL(string: uri) else {
      appliedSource = nil
      player.replaceCurrentItem(with: nil)
      return
    }

    let fingerprint = uri + "\u{1}" + sourceHeaders.sorted { $0.key < $1.key }
      .map { "\($0.key)=\($0.value)" }.joined(separator: "\u{1}")
    if appliedSource == fingerprint { return }
    appliedSource = fingerprint

    // `AVURLAssetHTTPHeaderFieldsKey` is the only way to authorize an AVFoundation media load;
    // there is no per-request hook once the asset exists.
    let asset = AVURLAsset(
      url: url,
      options: sourceHeaders.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": sourceHeaders]
    )
    let item = AVPlayerItem(asset: asset)

    // 32BGRA because the buffers are drained and discarded — nothing here renders them, the
    // layer does that. The output exists purely as a clock.
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
    ])
    item.add(output)
    videoOutput = output

    statusObservation = item.observe(\.status, options: [.new]) { [weak self] observedItem, _ in
      guard let self else { return }
      switch observedItem.status {
      case .readyToPlay:
        let track = observedItem.asset.tracks(withMediaType: .video).first
        self.onReady([
          "durationMs": CMTimeGetSeconds(observedItem.duration).isFinite
            ? CMTimeGetSeconds(observedItem.duration) * 1000 : 0,
          "width": Int(track?.naturalSize.width ?? 0),
          "height": Int(track?.naturalSize.height ?? 0),
          // Reported so a disagreement with the `fps` prop is visible rather than silently
          // absorbed into wrong frame indices.
          "containerFps": Double(track?.nominalFrameRate ?? 0)
        ])
        self.startDisplayLink()
      case .failed:
        self.onPlayerError(["message": observedItem.error?.localizedDescription ?? "unknown"])
      default:
        break
      }
    }

    player.replaceCurrentItem(with: item)
  }

  private func startDisplayLink() {
    stopDisplayLink()
    let link = CADisplayLink(target: self, selector: #selector(onVSync(_:)))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopDisplayLink() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func onVSync(_ link: CADisplayLink) {
    guard let output = videoOutput else { return }

    // The host time of the NEXT vsync — i.e. the moment the frame we are about to identify will
    // actually be on screen.
    let hostTime = link.targetTimestamp
    let itemTime = output.itemTime(forHostTime: hostTime)
    guard itemTime.isValid, itemTime.seconds.isFinite, itemTime.seconds >= 0 else { return }

    // Drain the output even though nothing consumes the pixels. An output that is added but never
    // read can stall the pipeline, and a stalled clock would make every number below flattering
    // and wrong.
    if output.hasNewPixelBuffer(forItemTime: itemTime) {
      _ = output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil)
    }

    let frame = frameIndex(seconds: itemTime.seconds, fps: fps)
    queuedFrame = frame

    if let expected = pendingSeekFrame {
      pendingSeekFrame = nil
      seekError.add(Double(frame - expected))
    }

    guard frame != lastEmittedFrame else { return }
    lastEmittedFrame = frame

    scheduled.append((frame: frame, displayAt: hostTime))
    if scheduled.count > 16 { scheduled.removeFirst(scheduled.count - 16) }

    if emitFrames {
      // Positive = JS heard about the frame this many ms before it is due on screen. Same
      // quantity and same sign convention as the Android side, so the two columns compare.
      leadTimeMs.add((hostTime - CACurrentMediaTime()) * 1000.0)
      onFrameRendered([
        "frame": frame,
        "presentationTimeUs": Int(itemTime.seconds * 1_000_000),
        "releaseTimeNs": Int(hostTime * 1_000_000_000)
      ])
    }
  }

  func play() { player.play() }

  func pause() { player.pause() }

  /// Zero tolerance in both directions — the iOS equivalent of `SeekParameters.EXACT`. Without
  /// this AVPlayer is free to land on a nearby sync sample, which looks correct and is up to a
  /// GOP out.
  func seekToFrame(_ frame: Int) {
    pendingSeekFrame = frame
    let target = CMTime(seconds: seekTargetSeconds(frame: frame, fps: fps), preferredTimescale: 600)
    player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
  }

  func markOverlayCommitted(_ frame: Int) {
    // Against what is ON SCREEN, not what has merely been queued — see onScreenFrame().
    let current = onScreenFrame()
    guard current >= 0 else { return }
    overlayDrift.add(Double(current - frame))
  }

  func resetStats() {
    overlayDrift.reset()
    leadTimeMs.reset()
    seekError.reset()
    scheduled.removeAll(keepingCapacity: true)
  }

  func stats() -> [String: Any] {
    [
      "overlayDriftFrames": overlayDrift.toDictionary(),
      "leadTimeMs": leadTimeMs.toDictionary(),
      "seekErrorFrames": seekError.toDictionary(),
      "onScreenFrame": onScreenFrame(),
      "queuedFrame": queuedFrame,
      // The player's OWN bookkeeping — a third answer to "where are we", reported next to the
      // other two precisely so a disagreement is visible.
      "positionMs": CMTimeGetSeconds(player.currentTime()).isFinite
        ? CMTimeGetSeconds(player.currentTime()) * 1000 : 0,
      "playing": player.timeControlStatus == .playing,
      "fps": fps
    ]
  }

  func release() {
    stopDisplayLink()
    statusObservation = nil
    player.replaceCurrentItem(with: nil)
  }
}
