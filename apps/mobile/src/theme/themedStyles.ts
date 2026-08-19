import { StyleSheet } from "react-native";

import { useAppTheme, useTheme } from "./ThemeProvider";
import type { Theme } from "./themes";

/**
 * The one pattern for theme-aware `StyleSheet`s.
 *
 * Usage — declare at module scope, call as a hook:
 *
 * ```ts
 * const useStyles = themedStyles((t) => ({
 *   root: { flex: 1, backgroundColor: t.bg },
 * }));
 * function Screen() {
 *   const styles = useStyles();
 * }
 * ```
 *
 * Sheets are built once per theme and cached: `LIGHT`/`DARK` are the only two `Theme` objects
 * in existence and they are module constants, so the map can key on identity and a theme flip
 * costs one `StyleSheet.create` per component module, ever. Components therefore keep the
 * exact perf shape of a static sheet — no per-render style objects, which is what keeps this
 * legal near the player's memo boundaries.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (t: Theme) => T,
): () => T {
  const cache = new Map<Theme, T>();
  return function useStyles(): T {
    const t = useTheme();
    let sheet = cache.get(t);
    if (!sheet) {
      sheet = StyleSheet.create(factory(t));
      cache.set(t, sheet);
    }
    return sheet;
  };
}

/**
 * `themedStyles` against the APP's surface, ignoring any `FixedDarkTheme` pin above.
 *
 * Sheet content needs this and `themedStyles` cannot give it. `Sheet` wraps its children in an
 * `AppTheme` provider, but a sheet component calls its style hook in **its own body** — which
 * runs where the sheet is *used* (inside the pinned-dark capture screen), not where its children
 * are *rendered* (inside the provider). Context flows down the tree, and the parent is not below
 * its own child. The symptom is precise and easy to misread: the panel paints white correctly,
 * and the text on it stays dark-theme white, so the content looks blank rather than mis-themed.
 *
 * Same caching contract as `themedStyles` — one built sheet per theme, for the whole process.
 */
export function appStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (t: Theme) => T,
): () => T {
  const cache = new Map<Theme, T>();
  return function useStyles(): T {
    const t = useAppTheme();
    let sheet = cache.get(t);
    if (!sheet) {
      sheet = StyleSheet.create(factory(t));
      cache.set(t, sheet);
    }
    return sheet;
  };
}
