package expo.modules.frameclock

import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

@UnstableApi
class FrameClockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FrameClock")

    View(FrameClockView::class) {
      Events("onFrameRendered", "onReady", "onPlayerError")

      Prop("source") { view: FrameClockView, uri: String? ->
        view.setSource(uri)
      }

      // The session travels with the media request. Declared BEFORE `source` would be no help —
      // prop order is not a contract — so the view applies whichever arrives second (D50).
      Prop("headers") { view: FrameClockView, headers: Map<String, String>? ->
        view.setHeaders(headers ?: emptyMap())
      }

      // Both setters above only record. The player is prepared here, once the whole batch has
      // landed, so a source can never be fetched with headers that had not arrived yet (D50).
      OnViewDidUpdateProps { view: FrameClockView ->
        view.applySource()
      }

      Prop("fps") { view: FrameClockView, fps: Double ->
        view.fps = fps
      }

      Prop("emitFrames") { view: FrameClockView, emit: Boolean ->
        view.emitFrames = emit
      }

      Prop("surfaceType") { view: FrameClockView, type: String ->
        view.setSurfaceType(type)
      }


      AsyncFunction("play") { view: FrameClockView ->
        view.play()
      }

      AsyncFunction("pause") { view: FrameClockView ->
        view.pause()
      }

      AsyncFunction("seekToFrame") { view: FrameClockView, frame: Int ->
        view.seekToFrame(frame)
      }

      AsyncFunction("markOverlayCommitted") { view: FrameClockView, frame: Int ->
        view.markOverlayCommitted(frame)
      }

      AsyncFunction("setSeekMode") { view: FrameClockView, mode: String ->
        view.seekMode = mode
      }
      AsyncFunction("setPlaybackSpeed") { view: FrameClockView, speed: Double ->
        view.setPlaybackSpeed(speed.toFloat())
      }
      AsyncFunction("getStats") { view: FrameClockView ->
        view.stats()
      }

      AsyncFunction("resetStats") { view: FrameClockView ->
        view.resetStats()
      }

      OnViewDestroys { view: FrameClockView ->
        view.release()
      }
    }
  }
}
