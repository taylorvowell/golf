/**
 * The build's fingerprint. The literal on the BUILD_STAMP line is rewritten by
 * `scripts/release-device.mjs` for each release build and restored afterwards — a changed
 * source file is what forces gradle to re-bundle, and the script then refuses to install an
 * APK whose JS lacks the stamp it just wrote.
 *
 * The global assignment is load-bearing, not decoration: a release bundle is MINIFIED, and a
 * `const` string nothing observes is dead code the minifier deletes — which is exactly how
 * the tripwire kept reporting STALE against a freshly-written bundle (2026-08-23). Writing to
 * a global is a side effect no minifier may drop, so the literal survives into the shipped JS.
 */
export const BUILD_STAMP: string = "dev";

(globalThis as unknown as Record<string, string>).__SWINGSAGE_BUILD__ = BUILD_STAMP;
