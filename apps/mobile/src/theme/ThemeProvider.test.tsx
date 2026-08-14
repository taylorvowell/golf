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
 * Pins the resolution rules a golfer would notice: **light is the default**, dark appears only
 * by asking for it (Settings) or by running the phone dark, and an explicit choice always beats
 * the phone. Colour values are deliberately not asserted — they are design, not behaviour.
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

test("defaults to light when the phone reports no scheme", async () => {
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("defaults to light on a light phone", async () => {
  mockOsScheme = "light";
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("follows a dark phone when nothing was chosen", async () => {
  mockOsScheme = "dark";
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("dark");
});

test("an explicit light choice beats a dark phone", async () => {
  mockOsScheme = "dark";
  await renderProbe();
  fireEvent.press(screen.getByTestId("choose-light"));
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("an explicit dark choice beats a light phone, and persists", async () => {
  mockOsScheme = "light";
  await renderProbe();
  fireEvent.press(screen.getByTestId("choose-dark"));
  expect(await screen.findByTestId("mode")).toHaveTextContent("dark");

  // A fresh mount (a cold start) reads the stored choice back.
  clearThemePreferenceCache();
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("dark");
});

test("a stored value nobody recognises resolves to the default, not a crash", async () => {
  await AsyncStorage.setItem("swingsage.theme-preference.v1", "plaid");
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});
