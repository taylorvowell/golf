import ExpoModulesCore

public class FrameClockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FrameClock")

    View(FrameClockView.self) {
      Events("onFrameRendered", "onReady", "onPlayerError")

      Prop("source") { (view: FrameClockView, uri: String?) in
        view.setSource(uri)
      }

      // The session travels with the media request. Declaring it before `source` would be no help
      // — prop order is not a contract — so the view applies whichever arrives second (D50).
      Prop("headers") { (view: FrameClockView, headers: [String: String]?) in
        view.setHeaders(headers ?? [:])
      }

      Prop("fps") { (view: FrameClockView, fps: Double) in
        view.fps = fps
      }

      Prop("emitFrames") { (view: FrameClockView, emit: Bool) in
        view.emitFrames = emit
      }

      // Android-only concept (SurfaceView vs TextureView). Declared here so the same JS props
      // typecheck and run on both platforms; AVPlayerLayer has no equivalent choice to make.
      Prop("surfaceType") { (_: FrameClockView, _: String) in
      }

      AsyncFunction("play") { (view: FrameClockView) in
        view.play()
      }

      AsyncFunction("pause") { (view: FrameClockView) in
        view.pause()
      }

      AsyncFunction("seekToFrame") { (view: FrameClockView, frame: Int) in
        view.seekToFrame(frame)
      }

      AsyncFunction("markOverlayCommitted") { (view: FrameClockView, frame: Int) in
        view.markOverlayCommitted(frame)
      }

      AsyncFunction("getStats") { (view: FrameClockView) -> [String: Any] in
        view.stats()
      }

      AsyncFunction("resetStats") { (view: FrameClockView) in
        view.resetStats()
      }
    }
  }
}
