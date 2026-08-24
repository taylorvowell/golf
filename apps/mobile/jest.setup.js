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
 * AsyncStorage is a native module, and `src/features/auth/supabase.ts` reaches it at *import* —
 * so any file whose import graph touches the auth layer (the media-source hook does, for its
 * token-refresh subscription) fails to load with `NativeModule: AsyncStorage is null` before a
 * single test runs. The package ships an official in-memory mock for exactly this.
 */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

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

/**
 * `modules/frame-clock` is a local Expo module, so `requireNativeView("FrameClock")` throws under
 * jest at *import* — before any component renders — exactly like the two mocks above.
 *
 * The stand-in is a `View` that also exposes the imperative handle, because the player's whole
 * job is driving that handle: a test asserts that stepping a frame called `seekToFrame` with the
 * right index, which is the one thing about this player worth asserting off-device. The handle's
 * methods are re-created per instance so parallel tests cannot see each other's calls.
 */
/**
 * `modules/high-speed-camera`'s preview view is native for the same reason frame-clock's
 * is — `requireNativeView` throws at import under jest. A plain View stands in; what a
 * test would assert is which props (facing/zoom) reached it.
 */
jest.mock("./modules/high-speed-camera/src/HighSpeedCameraView", () => {
  const React = require("react");
  const { View } = require("react-native");
  const HighSpeedCameraView = (props) => React.createElement(View, props);
  return { __esModule: true, default: HighSpeedCameraView };
});

/**
 * The module INDEX throws the same way (`requireNativeModule` at import), and the swing log
 * now reaches it through the import review pass. Benign fakes: detection hears nothing (the
 * review screen's fallback mark is a designed state), the cutter answers with its input.
 */
jest.mock("./modules/high-speed-camera/src", () => {
  // No requireActual: the real index calls `requireNativeModule` at import, which is the very
  // throw this mock exists to avoid. The runtime constants SwingReview reads are restated.
  const IMPACT_METHODS = ["swish", "hf", "flux", "wideband"];
  return {
    __esModule: true,
    IMPACT_METHODS,
    IMPACT_METHOD_LABELS: Object.fromEntries(IMPACT_METHODS.map((m) => [m, m])),
    default: {
      detectImpacts: jest.fn().mockResolvedValue([]),
      clipThumbnails: jest.fn().mockResolvedValue([]),
      trimClip: jest.fn().mockImplementation((path) => Promise.resolve({ path })),
      deleteClip: jest.fn().mockResolvedValue(undefined),
      probeClip: jest.fn().mockResolvedValue({ captureFps: 0, videoFps: 30, durationMs: 5000 }),
    },
  };
});

/**
 * `expo-video` is a native module: `useVideoPlayer` reaches for a real player at import time and
 * throws under jest. The stand-in is a plain object whose properties can be written and read, so a
 * test can assert what the preview asked the player to do (seek, rate, muted) without a device.
 */
jest.mock("expo-video", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    useVideoPlayer: (_source, setup) => {
      const player = React.useMemo(
        () => ({
          muted: false,
          currentTime: 0,
          playbackRate: 1,
          timeUpdateEventInterval: 0,
          play: jest.fn(),
          pause: jest.fn(),
          addListener: jest.fn(() => ({ remove: jest.fn() })),
        }),
        [],
      );
      React.useMemo(() => setup?.(player), [player]);
      return player;
    },
    VideoView: (props) => React.createElement(View, props),
  };
});

jest.mock("./modules/frame-clock/src/FrameClockView", () => {
  const React = require("react");
  const { View } = require("react-native");

  const EMPTY_STAT = { count: 0, mean: 0, p50: 0, p95: 0, max: 0, exactShare: 0 };

  const FrameClockView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockResolvedValue(undefined),
      seekToFrame: jest.fn().mockResolvedValue(undefined),
      markOverlayCommitted: jest.fn().mockResolvedValue(undefined),
      setSeekMode: jest.fn().mockResolvedValue(undefined),
      setScrubbing: jest.fn().mockResolvedValue(undefined),
      setMuted: jest.fn().mockResolvedValue(undefined),
      setPlaybackSpeed: jest.fn().mockResolvedValue(undefined),
      getStats: jest.fn().mockResolvedValue({
        overlayDriftFrames: EMPTY_STAT,
        leadTimeMs: EMPTY_STAT,
        seekErrorFrames: EMPTY_STAT,
        onScreenFrame: 0,
        queuedFrame: 0,
        positionMs: 0,
        playing: false,
        fps: 60,
      }),
      resetStats: jest.fn().mockResolvedValue(undefined),
    }));
    return React.createElement(View, props);
  });
  FrameClockView.displayName = "FrameClockView";

  return { __esModule: true, default: FrameClockView };
});

/**
 * `react-native-safe-area-context` reads its insets from a native view, so `useSafeAreaInsets()`
 * throws *"No safe area value available"* under jest unless a provider with real metrics wraps the
 * tree — which every screen test would otherwise have to remember to do.
 *
 * Mocked with a phone-shaped notch and gesture bar rather than zeros. Zeros would let a layout
 * that ignores the insets pass here and then draw its back button under the status bar on the
 * device, which is precisely the class of bug this app cannot check in CI.
 */
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  return {
    ...actual,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 393, height: 852 }),
    SafeAreaProvider: ({ children }) => children,
    SafeAreaInsetsContext: {
      ...actual.SafeAreaInsetsContext,
      Consumer: ({ children }) => children(insets),
    },
  };
});
