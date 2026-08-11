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

  private var presentedFrame: Int = -1
  private var pendingSeekFrame: Int?
  private var lastEmittedFrame: Int = -1

  private let overlayDrift = FrameStats()
  private let deliveryLatencyMs = FrameStats()
  private let seekError = FrameStats()

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

  func setSource(_ uri: String?) {
    stopDisplayLink()
    statusObservation = nil

    guard let uri, !uri.isEmpty, let url = URL(string: uri) else {
      player.replaceCurrentItem(with: nil)
      return
    }

    let item = AVPlayerItem(url: url)

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
    presentedFrame = frame

    if let expected = pendingSeekFrame {
      pendingSeekFrame = nil
      seekError.add(Double(frame - expected))
    }

    guard frame != lastEmittedFrame else { return }
    lastEmittedFrame = frame

    if emitFrames {
      // The display link already fires on the main thread, so this is the same hop the Android
      // side pays via Handler.post — measured the same way for the same reason.
      deliveryLatencyMs.add((CACurrentMediaTime() - hostTime) * 1000.0)
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
    guard presentedFrame >= 0 else { return }
    overlayDrift.add(Double(presentedFrame - frame))
  }

  func resetStats() {
    overlayDrift.reset()
    deliveryLatencyMs.reset()
    seekError.reset()
  }

  func stats() -> [String: Any] {
    [
      "overlayDriftFrames": overlayDrift.toDictionary(),
      "eventDeliveryMs": deliveryLatencyMs.toDictionary(),
      "seekErrorFrames": seekError.toDictionary(),
      "presentedFrame": presentedFrame,
      "fps": fps
    ]
  }

  func release() {
    stopDisplayLink()
    statusObservation = nil
    player.replaceCurrentItem(with: nil)
  }
}
