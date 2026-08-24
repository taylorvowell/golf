const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Locks EVERY activity in the merged manifest to portrait, not just `MainActivity`.
 *
 * `expo.orientation: "portrait"` only stamps `android:screenOrientation` on the app's own
 * MainActivity. Activities that arrive from library manifests declare nothing, so they inherit
 * `unspecified` and follow the sensor — the dev-client launcher is the visible one, because it
 * is the first screen on every debug launch and it rotates before the app's own activity is
 * ever on screen. That reads exactly like the phone's rotation lock came off.
 *
 * The manifest merger keys on `android:name`, so a stub carrying only the attribute merges into
 * the library's declaration rather than replacing it. `tools:node="merge"` makes that explicit
 * and `tools:replace` covers the ones that ship a value of their own.
 */
const PORTRAIT_ACTIVITIES = [
  // expo-dev-client: the launcher, its auth webview, and the red-box error screen.
  "expo.modules.devlauncher.launcher.DevLauncherActivity",
  "expo.modules.devlauncher.compose.AuthActivity",
  "expo.modules.devlauncher.launcher.errors.DevLauncherErrorActivity",
  // React Native's dev-menu settings screen.
  "com.facebook.react.devsupport.DevSettingsActivity",
  // expo-video's fullscreen presentation — swing video is portrait, so this stays portrait too.
  "expo.modules.video.FullscreenPlayerActivity",
  // expo-image-picker's cropper.
  "com.canhub.cropper.CropImageActivity",
  "expo.modules.imagepicker.ExpoCropImageActivity",
];

module.exports = function withPortraitOnly(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    app.activity = app.activity ?? [];

    for (const name of PORTRAIT_ACTIVITIES) {
      const existing = app.activity.find((a) => a.$?.["android:name"] === name);
      const target = existing ?? { $: { "android:name": name } };
      target.$["android:screenOrientation"] = "portrait";
      target.$["tools:node"] = "merge";
      target.$["tools:replace"] = "android:screenOrientation";
      if (!existing) app.activity.push(target);
    }

    // MainActivity is already portrait from `expo.orientation`, but pin it here too so the
    // guarantee does not depend on that one field surviving an app.json edit.
    const main = app.activity.find((a) => a.$?.["android:name"] === ".MainActivity");
    if (main) main.$["android:screenOrientation"] = "portrait";

    return cfg;
  });
};
