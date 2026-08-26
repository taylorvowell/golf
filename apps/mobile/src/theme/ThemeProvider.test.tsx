import { Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { act } from "@testing-library/react-native";

import { clearAppModeCache, setAppMode } from "../features/mode/appMode";
import {
  ThemeProvider,
  clearThemePreferenceCache,
  useTheme,
  useThemePreference,
} from "./ThemeProvider";
import { INSTRUCTOR } from "./themes";

/**
 * Pins the resolution rules a person would notice: **personal mode is light, always** — neither
 * the phone's dark mode nor a stored preference changes it — and **instructor mode wears the
 * charcoal INSTRUCTOR binding**, selected by the app mode alone. Colour values are deliberately
 * not asserted — they are design, not behaviour — except the one bg read that proves the third
 * binding is the one resolved (mode "dark" alone would also be true of DARK).
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
      <Text testID="bg">{t.bg}</Text>
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
  clearAppModeCache();
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

test("instructor mode resolves the INSTRUCTOR binding, and leaving it restores light", async () => {
  await renderProbe();
  // This root's act is async — unawaited, its scope interleaves with the next render's.
  await act(async () => setAppMode("instructor"));
  expect(await screen.findByTestId("mode")).toHaveTextContent("dark");
  // The charcoal ground, not DARK's navy — proves WHICH dark binding the mode selected.
  expect(await screen.findByTestId("bg")).toHaveTextContent(INSTRUCTOR.bg);
  await act(async () => setAppMode("personal"));
  expect(await screen.findByTestId("mode")).toHaveTextContent("light");
});

test("a stored instructor mode survives a cold start", async () => {
  await AsyncStorage.setItem("swingsage.app-mode.v1", "instructor");
  await renderProbe();
  expect(await screen.findByTestId("mode")).toHaveTextContent("dark");
});
