import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { ChartNoAxesColumnIncreasing, House, Rows3, Sparkles } from "lucide-react-native";

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

function iconFor(route: string): WaveNavItem["icon"] {
  switch (route) {
    case "Home":
      return (color) => <House size={21} color={color} strokeWidth={2} />;
    case "SwingLog":
      return (color) => <Rows3 size={21} color={color} strokeWidth={2} />;
    case "Progress":
      return (color) => (
        <ChartNoAxesColumnIncreasing size={21} color={color} strokeWidth={2} />
      );
    default:
      return (color) => <Sparkles size={21} color={color} strokeWidth={2} />;
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
