import { StyleSheet } from "react-native";

import { useTheme } from "./ThemeProvider";
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
