import appConfig from "../../app.json";

/**
 * This build's version, as the server sees it.
 *
 * Read from `app.json` — the same field EAS stamps into the binary — rather than hardcoded, so
 * bumping the version in one place moves what the server is told. A build that reports the wrong
 * version is worse than one that reports none: the server would serve it under a floor it does
 * not actually satisfy.
 *
 * Imported directly rather than through `expo-constants`. Metro bundles JSON, the file is the
 * source of truth either way, and this keeps the version readable from a plain unit test with no
 * native module to mock.
 */
export const CLIENT_VERSION: string = appConfig.expo.version;
