package expo.modules.shutterremote

import android.os.Build
import android.util.Log
import android.view.KeyEvent
import android.view.View
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A Bluetooth camera shutter remote (and the phone's own volume rocker) as a record trigger.
 *
 * Those remotes pair as a one-key Bluetooth HID keyboard: a press is a plain key event —
 * almost always VOLUME_UP, with ENTER from some models' second button. While the capture
 * screen holds `setActive(true)` the app claims those keys through the decor view's
 * unhandled-key path (they reach it because no React view handles hardware keys, and it runs
 * before the window's fallback volume handling) and consumes them, so a press never also
 * moves media volume. Inactive, nothing is attached and the keys behave normally everywhere
 * else in the app.
 */
class ShutterRemoteModule : Module() {
  private var attachedTo: View? = null
  private var listener: View.OnUnhandledKeyEventListener? = null

  override fun definition() = ModuleDefinition {
    Name("ShutterRemote")
    Events("onShutterKey")

    AsyncFunction("setActive") { active: Boolean ->
      // addOnUnhandledKeyEventListener is API 28+; below that the remote is simply inert.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return@AsyncFunction
      val activity = appContext.currentActivity
      if (activity == null) {
        Log.w(TAG, "setActive($active): no current activity")
        return@AsyncFunction
      }
      activity.runOnUiThread {
        detach()
        if (!active) return@runOnUiThread
        val decor = activity.window?.decorView ?: return@runOnUiThread
        val l = View.OnUnhandledKeyEventListener { _, event ->
          val claimed = event.keyCode in SHUTTER_KEYS
          if (claimed && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            Log.i(TAG, "claimed keyCode=${event.keyCode}")
            sendEvent("onShutterKey", mapOf("keyCode" to event.keyCode))
          }
          // Consume UP and held repeats too — a claimed key must never half-leak into the
          // system volume UI mid-recording.
          claimed
        }
        decor.addOnUnhandledKeyEventListener(l)
        attachedTo = decor
        listener = l
        Log.i(TAG, "listener attached to decor view")
      }
    }

    OnDestroy {
      appContext.currentActivity?.runOnUiThread { detach() }
    }
  }

  private fun detach() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      listener?.let { attachedTo?.removeOnUnhandledKeyEventListener(it) }
    }
    attachedTo = null
    listener = null
  }

  private companion object {
    const val TAG = "ShutterRemote"

    /** Every key these remotes are known to send, plus the rocker itself. */
    val SHUTTER_KEYS = setOf(
      KeyEvent.KEYCODE_VOLUME_UP,
      KeyEvent.KEYCODE_VOLUME_DOWN,
      KeyEvent.KEYCODE_ENTER,
      KeyEvent.KEYCODE_NUMPAD_ENTER,
      KeyEvent.KEYCODE_DPAD_CENTER,
      KeyEvent.KEYCODE_CAMERA,
      KeyEvent.KEYCODE_FOCUS,
      KeyEvent.KEYCODE_HEADSETHOOK,
    )
  }
}
