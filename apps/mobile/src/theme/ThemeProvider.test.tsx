import { Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";

import {
  ThemeProvider,
  clearThemePreferenceCache,
  useTheme,
  useThemePreference,
} from "./ThemeProvider";

/**
 * Pins the one resolution rule a golfer would notice: **the app is light, always**. Neither the
 * phone's dark mode nor a stored preference from an earlier build changes it. Colour values are
 * deliberately not asserted — they are design, not behaviour.
 */

// The provider reads the OS scheme through `useColorScheme`; the variable is the OS knob.
// The `mock` prefix is jest's escape hatch for out-of-scope access in a mock factory.
let mockOsScheme: "light" | "dark" | null = null;
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockOsScheme,
}));

function Probe() {
  const t = useTheme();
  const { set } = useThemePreference();
  return (
    <>
      <Text testID="mode">{t.mode}</Text>
      <Text testID="choose-light" onPress={() => set("light")}>
        choose light
      </Text>
      <Text testID="choose-dark" onPress={() => set("dark")}>
        choose dark
      </Text>
    </>
  );
}

async function renderProbe() {
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  mockOsScheme = null;
  clearThemePreferenceCache();
  await AsyncStorage.clear();
});

test("is light when the phone reports no scheme", async () => {
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("is light on a light phone", async () => {
  mockOsScheme = "light";
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("stays light on a dark phone — the phone's scheme is not followed", async () => {
  mockOsScheme = "dark";
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("stays light after a dark choice is written, and across a cold start", async () => {
  mockOsScheme = "dark";
  await renderProbe();
  fireEvent.press(screen.getByTestId("choose-dark"));
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");

  clearThemePreferenceCache();
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("a stored dark preference from an earlier build does not un-pin it", async () => {
  await AsyncStorage.setItem("swingsage.theme-preference.v1", "dark");
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});
