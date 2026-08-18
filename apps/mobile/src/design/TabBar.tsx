import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { BrandIcon } from "./system/BrandIcon";
import { WaveNav, type WaveNavItem } from "./system/WaveNav";
import { useNavVisibility } from "./system/navVisibility";

/**
 * The app's persistent bottom bar, now a thin adapter: React Navigation's tabBar props →
 * the design system's `WaveNav`. The contract is unchanged from the old drawn bar — four
 * tabs that switch (tabPress emitted, re-press a no-op), and **Record** raised in the middle
 * as a door to the capture surface on the root stack, never a tab, so coming back from
 * recording lands exactly where the golfer left.
 *
 * Visibility comes from `navVisibility` — a screen may hide the bar only as a deterministic
 * function of its scroll position (the amended chrome rule; the report screen is the user).
 */

const LABELS: Record<string, string> = {
  Home: "Home",
  SwingLog: "Swings",
  Progress: "Progress",
  Coach: "Coach",
};

/** One knob for the whole row — the tab glyph size (Taylor 2026-08-17: larger). */
const ICON_SIZE = 26;

function iconFor(route: string): WaveNavItem["icon"] {
  switch (route) {
    case "Home":
      return (color) => <BrandIcon name="home" size={ICON_SIZE} color={color} />;
    case "SwingLog":
      return (color) => <BrandIcon name="swingLog" size={ICON_SIZE} color={color} />;
    case "Progress":
      return (color) => <BrandIcon name="progress" size={ICON_SIZE} color={color} />;
    default:
      // Coach carries the supplied golfer glyph rather than a lucide icon.
      return (color) => <BrandIcon name="coach" size={ICON_SIZE} color={color} />;
  }
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { hidden } = useNavVisibility();

  const items: WaveNavItem[] = state.routes.map((route, index) => ({
    key: route.key,
    label: LABELS[route.name] ?? route.name,
    icon: iconFor(route.name),
    active: state.index === index,
    testID: `tab-${route.name}`,
    onPress: () => {
      // The standard tabPress contract: screens may preventDefault (none do today), and
      // re-pressing the current tab is a no-op rather than a re-push.
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
    },
  }));

  return (
    <WaveNav
      items={items}
      hidden={hidden}
      recordTestID="tab-record"
      onRecord={() => navigation.navigate("Record" as never)}
    />
  );
}
