import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { DARK, LIGHT, type Theme } from "./themes";

/**
 * Which face the app wears, and who decides.
 *
 * **Light is the default.** Dark appears only when the golfer asks for it — explicitly in
 * Settings, or implicitly by running their phone in dark mode (`"system"`, the initial state).
 * A phone that reports no scheme resolves light, never dark.
 *
 * The preference is device-local and persisted exactly like the after-swing summary preference
 * (same module-cache idiom, same reasons): screens only ever see `{ preference, set }`, so
 * moving it into account preferences later is a rewire of this file alone.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "swingsage.theme-preference.v1";
const DEFAULT: ThemePreference = "system";

let cached: ThemePreference | null = null;
let loading: Promise<ThemePreference> | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT;
}

async function ensureLoaded(): Promise<ThemePreference> {
  if (cached !== null) return cached;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then(parse)
    // A corrupt store must not wedge the app — fall back to the default and move on.
    .catch(() => DEFAULT);
  cached = await loading;
  return cached;
}

/** The tests' reset seam. */
export function clearThemePreferenceCache(): void {
  cached = null;
  loading = null;
}

export function useThemePreference(): {
  /** `null` until the stored value has been read. */
  preference: ThemePreference | null;
  set: (value: ThemePreference) => void;
} {
  const [value, setValue] = useState<ThemePreference | null>(cached);

  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setValue(cached);
    };
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);

  const set = useCallback((next: ThemePreference) => {
    cached = next;
    // Fire and forget — the in-memory value is already what every screen reads.
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
    for (const listener of listeners) listener();
  }, []);

  return { preference: value, set };
}

/**
 * Default `LIGHT` rather than `null`-and-throw: the player's dark surfaces never mount a
 * provider in tests, and light is the honest ambient answer everywhere else.
 */
const ThemeContext = createContext<Theme>(LIGHT);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { preference } = useThemePreference();
  const scheme = useColorScheme();

  // An unloaded preference (a frame or two on cold start) behaves as "system" — following the
  // phone is the least-wrong guess in both directions while the store answers.
  const dark =
    preference === "dark" || (preference !== "light" && scheme === "dark");

  return (
    <ThemeContext.Provider value={dark ? DARK : LIGHT}>
      {children}
    </ThemeContext.Provider>
  );
}

/** The resolved theme every themed component reads. Semantic tokens only — see `themes.ts`. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Pins a subtree to the dark theme regardless of the app's resolved theme.
 *
 * The video-facing surfaces (the player screen, capture) are dark in both themes — a control
 * surface over footage keeps its own light. Without this pin, a themed shared component
 * rendered inside them (the after-swing trend line, a status message) would paint light-theme
 * tokens over a dark picture.
 */
export function FixedDarkTheme({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={DARK}>{children}</ThemeContext.Provider>;
}
