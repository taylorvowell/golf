import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAppMode } from "../features/mode/appMode";
import { DARK, INSTRUCTOR, LIGHT, type Theme } from "./themes";

/**
 * Which face the app wears, and who decides.
 *
 * **In personal mode the app is pinned to LIGHT** (Taylor, 2026-08-18). There is no theme
 * choice: the phone's dark mode is not followed, no Settings control changes it, and a stored
 * preference from an earlier build is ignored. `FixedDarkTheme` still pins the video-facing
 * surfaces dark, which is a property of those screens rather than a theme choice.
 *
 * **In INSTRUCTOR mode the app wears `INSTRUCTOR`** — the charcoal binding (the
 * instructor-platform architecture §5, accepted 2026-08-26). This is the APP MODE selecting a
 * face, not a theme preference: the golfer pin above is untouched, and switching back is
 * switching the mode. The mode lives in a module store (`features/mode/appMode`), so this
 * provider — near the root, above auth — can read it without a provider above itself.
 *
 * The DARK theme, every dark token and every `t.mode === "dark"` branch are deliberately kept —
 * un-pinning light/dark for golfers is still this file's `resolved` line and re-mounting the
 * Settings control, nothing more.
 *
 * The preference store below is that seam, left intact and unread. It is device-local and
 * persisted exactly like the after-swing summary preference (same module-cache idiom, same
 * reasons), so moving it into account preferences later is a rewire of this file alone.
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

/**
 * The app's own resolved surface, as context — LIGHT in personal mode, INSTRUCTOR in
 * instructor mode. A SECOND context beside `ThemeContext` because the two answer different
 * questions: "what theme is here" (a `FixedDarkTheme` pin may answer DARK) versus "what is
 * the app's ambient surface" (what `useAppTheme`/`AppTheme` restore inside a pin). Defaults
 * LIGHT for the same reason `ThemeContext` does: dark-pinned surfaces mount providerless in
 * tests, and light is the honest ambient answer.
 */
const AppSurfaceContext = createContext<Theme>(LIGHT);

/** Personal mode's face — still pinned LIGHT; see the note at the top of this file. */
function resolveAppTheme(mode: "personal" | "instructor"): Theme {
  return mode === "instructor" ? INSTRUCTOR : LIGHT;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolved = resolveAppTheme(useAppMode());
  return (
    <AppSurfaceContext.Provider value={resolved}>
      <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>
    </AppSurfaceContext.Provider>
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

/**
 * The app's surface, ignoring any `FixedDarkTheme` pin above.
 *
 * For the **sticky navigation bars only** (Taylor, 2026-08-18): every bar in the app is the
 * same bar, so the capture screen's `SessionNav` wears the home tab bar's light fill even
 * though the surface it floats over is pinned dark. Nothing else escapes the pin — content
 * drawn over footage still uses the fixed dark palette, which is the whole point of the pin.
 */
export function useAppTheme(): Theme {
  return useContext(AppSurfaceContext);
}

/**
 * Restores the app's surface for a subtree inside a `FixedDarkTheme` pin.
 *
 * `Sheet` applies it to every panel's content (Taylor, 2026-08-18): a slide-in is an app
 * surface, not a control over footage, so a sheet opened from the capture screen reads like the
 * swing log's sheet. Applied by the primitive so a sheet author cannot forget it.
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const app = useAppTheme();
  return <ThemeContext.Provider value={app}>{children}</ThemeContext.Provider>;
}
