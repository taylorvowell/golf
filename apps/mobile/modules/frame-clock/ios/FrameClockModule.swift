import ExpoModulesCore

public class FrameClockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FrameClock")

    View(FrameClockView.self) {
      Events("onFrameRendered", "onReady", "onPlayerError")

      Prop("source") { (view: FrameClockView, uri: String?) in
        view.setSource(uri)
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
