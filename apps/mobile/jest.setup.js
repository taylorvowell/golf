/**
 * Test-only values for the EXPO_PUBLIC_* variables the app reads at import time.
 *
 * `src/features/auth/supabase.ts` refuses to load without a Supabase URL and key — deliberately,
 * because a build that silently starts with no auth backend fails much later and much less
 * clearly. That means the suite has to supply them, and these are obvious nonsense on sight so
 * nobody mistakes a test default for a real project.
 *
 * Set here rather than in a committed `.env`: Expo loads `.env` for the app, and a file that both
 * the app and the tests read is a file where a test value can reach a device build.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test-project.supabase.invalid";
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only";
process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "test-web-client-id.apps.googleusercontent.com";
process.env.EXPO_PUBLIC_API_BASE_URL = "http://api.test.invalid";

/**
 * Google Sign-In is a native module, so importing it under jest throws
 * `TurboModuleRegistry.getEnforcing('RNGoogleSignin')` before a single line of our code runs.
 *
 * Mocked here rather than per test file because the failure is at *import*: any component that
 * renders the sign-in button inherits it, including tests that have nothing to do with auth. The
 * package ships its own jest setup, but it mocks a path that does not match how this workspace
 * resolves the module (hoisted node_modules, source entry), so it silently mocks nothing.
 *
 * A test that cares about the flow itself re-mocks this module with its own spies —
 * `src/features/auth/google.test.ts` does exactly that, and a later registration wins.
 */
jest.mock("@react-native-google-signin/google-signin", () => {
  const React = require("react");
  const { View } = require("react-native");

  const GoogleSigninButton = (props) => React.createElement(View, props);
  GoogleSigninButton.Size = { Icon: 2, Standard: 0, Wide: 1 };
  GoogleSigninButton.Color = { Dark: "dark", Light: "light" };

  return {
    GoogleSigninButton,
    GoogleSignin: {
      configure: jest.fn(),
      hasPlayServices: jest.fn().mockResolvedValue(true),
      signIn: jest.fn().mockResolvedValue({ type: "cancelled" }),
      signOut: jest.fn().mockResolvedValue(null),
    },
    statusCodes: { SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED" },
    isErrorWithCode: (e) => typeof e === "object" && e !== null && "code" in e,
    isSuccessResponse: (r) => r?.type === "success",
  };
});

/**
 * `expo-image` is a native module and its web/observer shim throws under jest
 * (`observe.getIntegrations is not a function`) at *import*, before any component renders.
 *
 * Mocked to a plain `Image` so tests still see a real element with the source they expect — which
 * matters here more than usual: the reason this component is `expo-image` at all is that React
 * Native's own `Image` silently drops the `headers` on its source, so the thing worth asserting is
 * that a source with an `Authorization` header reaches the component.
 */
jest.mock("expo-image", () => {
  const React = require("react");
  const { Image: RNImage } = require("react-native");
  return { Image: (props) => React.createElement(RNImage, props) };
});
