import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DevSettings, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WAVE_NAV_CLEARANCE } from "../../design/system/WaveNav";
import { FONT_DISPLAY } from "../../design/system/typography";
import { DebugSheet, type DebugGroup } from "../session/sheets/DebugSheet";

/**
 * The app-wide debug overlay: one amber pill in the bottom-right corner of every screen, and the
 * panel behind it.
 *
 * It lives at the ROOT rather than on the screens that need it, because "which screen am I on"
 * is exactly the thing you are often trying to work out when you reach for it. Screens contribute
 * their own controls with `useDebugGroups` while they are mounted, so the panel always shows what
 * is reachable from where you are standing and nothing more.
 *
 * `__DEV__` only — the provider renders its children untouched in release, so neither the pill
 * nor the space it occupies can reach a store build.
 *
 * **Hiding it is deliberately NOT persisted.** A dev tool that stays hidden across launches is a
 * dev tool somebody spends an afternoon looking for; a reload brings it back.
 */

interface DebugRegistry {
  register: (id: string, groups: DebugGroup[]) => void;
  unregister: (id: string) => void;
}

const DebugContext = createContext<DebugRegistry | null>(null);

/**
 * Contribute debug controls for as long as this component is mounted.
 *
 * `groups` must be memoised by the caller — it is the effect's dependency, and a fresh array each
 * render would re-register on every frame.
 */
export function useDebugGroups(id: string, groups: DebugGroup[]): void {
  const registry = useContext(DebugContext);
  useEffect(() => {
    if (!__DEV__ || !registry) return undefined;
    registry.register(id, groups);
    return () => registry.unregister(id);
  }, [groups, id, registry]);
}

export function DebugProvider({ children }: { children: ReactNode }) {
  if (!__DEV__) return <>{children}</>;
  return <DebugHost>{children}</DebugHost>;
}

function DebugHost({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [contributed, setContributed] = useState<Record<string, DebugGroup[]>>({});
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  /** Best-effort mirror of the RN dev menu — it can also close from its own UI, which this
      cannot observe, so the switch may read stale until flipped again. A dev-tool quirk we take. */
  const [devMenuOpen, setDevMenuOpen] = useState(false);

  const register = useCallback((id: string, groups: DebugGroup[]) => {
    setContributed((prev) => ({ ...prev, [id]: groups }));
  }, []);
  const unregister = useCallback((id: string) => {
    setContributed((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
  const registry = useMemo(() => ({ register, unregister }), [register, unregister]);

  const groups = useMemo<DebugGroup[]>(
    () => [
      ...Object.values(contributed).flat(),
      {
        /* The standard dev-client controls, put back inside THIS menu (Taylor, 2026-08-19)
           after the floating bubble was hidden — one debug door, not two. Reload JS is the
           sheet's own refresh button (`onRefresh` below), not a group entry. */
        title: "Overlay",
        toggles: [
          {
            key: "dev-menu",
            label: "RN dev menu",
            detail: "Element inspector, performance monitor, Fast Refresh toggle.",
            value: devMenuOpen,
            onChange: (next) => {
              setDevMenuOpen(next);
              // Lazy require: expo-dev-menu rides inside expo-dev-client's DEV builds only,
              // so a static import would be dead (and fragile) code on every other path.
              const devMenu = require("expo-dev-menu") as {
                openMenu?: () => void;
                closeMenu?: () => void;
              };
              if (next) devMenu.openMenu?.();
              else devMenu.closeMenu?.();
            },
          },
          {
            key: "hide-overlay",
            label: "Hide debug overlay",
            detail: "Comes back on the next reload — deliberately not remembered.",
            value: hidden,
            onChange: (next) => {
              setHidden(next);
              if (next) setOpen(false);
            },
          },
        ],
      },
    ],
    [contributed, devMenuOpen, hidden],
  );

  return (
    <DebugContext.Provider value={registry}>
      {children}
      {!hidden ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Debug menu"
          // The tab is far narrower than a finger; the slop restores the old pill's target.
          hitSlop={{ right: 14, top: 10, bottom: 10 }}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.pill,
            // Clear the floating wave bar — it overlays the screen, so sitting inside its
            // strip would put the tab behind the menu.
            { bottom: insets.bottom + WAVE_NAV_CLEARANCE + 10 },
            pressed && styles.pressed,
          ]}
          testID="debug-overlay-open"
        >
          <Text style={styles.label}>DEBUG</Text>
        </Pressable>
      ) : null}
      <DebugSheet
        visible={open}
        onClose={() => setOpen(false)}
        groups={groups}
        onRefresh={() => DevSettings.reload()}
      />
    </DebugContext.Provider>
  );
}

const styles = StyleSheet.create({
  /* Amber on purpose — a control that forces fake states must never be mistakeable for one
     of the product's own. A very narrow tab glued to the left edge (flat left side), with the
     label rotated to read up the screen, so it stays reachable while covering almost nothing. */
  pill: {
    position: "absolute",
    left: 0,
    width: 14,
    height: 54,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,46,0.86)",
    zIndex: 9999,
  },
  label: {
    color: "#1B1204",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 6.5,
    letterSpacing: 0.6,
    // Rotation keeps the layout box, so the label gets its natural horizontal width and is
    // turned in place — without the explicit width it would wrap inside the 14px tab first.
    width: 44,
    textAlign: "center",
    transform: [{ rotate: "-90deg" }],
  },
  // Pressed is a FILL, never opacity (mobile-client register) — a deeper amber, same alpha.
  pressed: { backgroundColor: "rgba(168,120,26,0.9)" },
});
