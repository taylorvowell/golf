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

      Prop("fps") { view: FrameClockView, fps: Double ->
        view.fps = fps
      }

      Prop("emitFrames") { view: FrameClockView, emit: Boolean ->
        view.emitFrames = emit
      }

      Prop("surfaceType") { view: FrameClockView, type: String ->
        view.setSurfaceType(type)
      }

      Prop("overlayMode") { view: FrameClockView, mode: String ->
        view.setOverlayMode(mode)
      }

      /**
       * Strategy C's one and only data transfer. Everything the overlay will ever need for every
       * frame crosses here once, before playback — which is the entire point, because it means
       * the per-frame path contains no bridge at all.
       */
      AsyncFunction("setSkeleton") {
        view: FrameClockView,
        keypoints: FloatArray,
        perFrame: Int,
        bones: IntArray,
        boneColors: IntArray,
        jointColors: IntArray,
        minConf: Double ->
        view.setSkeleton(keypoints, perFrame, bones, boneColors, jointColors, minConf.toFloat())
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
