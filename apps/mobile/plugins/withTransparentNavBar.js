const { AndroidConfig, withAndroidStyles } = require("expo/config-plugins");

/**
 * Drops Android's contrast scrim from behind the 3-button navigation bar.
 *
 * The app is already edge-to-edge and the generated theme already sets
 * `android:navigationBarColor` to transparent — but from API 29 the system draws its OWN
 * translucent scrim behind three-button navigation so the buttons stay legible over arbitrary
 * content. That scrim is what reads as "the nav bar has a background" even though the app never
 * painted one, and it is why setting a colour appears to do nothing.
 *
 * `enforceNavigationBarContrast` is the only switch for it. It affects **three-button navigation
 * only** — under gesture navigation the bar is already fully transparent and this changes
 * nothing. Taylor's S25+ reports `settings get secure navigation_mode` = 0, i.e. three-button,
 * which is why he sees it and the emulator's gesture-nav default does not.
 *
 * A plugin rather than an edit to `android/res/values/styles.xml`: that directory is prebuild
 * output and is regenerated wholesale (`.claude/rules/react-native.md`). Landing this needs
 * `npx expo prebuild -p android --clean` and a reinstall — it is native config, not JS.
 */
module.exports = function withTransparentNavBar(config) {
  return withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      name: "android:enforceNavigationBarContrast",
      value: "false",
      // API 29 is where the attribute exists; below it there is no scrim to remove.
      targetApi: "29",
      parent: AndroidConfig.Styles.getAppThemeGroup(),
    });
    return cfg;
  });
};
