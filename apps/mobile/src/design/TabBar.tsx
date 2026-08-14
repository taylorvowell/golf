import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BarsGlyph, HouseGlyph, PersonGlyph, RowsGlyph } from "./deck";
import { themedStyles, useTheme } from "../theme";

/**
 * The app's persistent bottom bar: Home and the log on the left, Progress and Coach on the
 * right, and **Record** raised in the middle — the one action the whole product exists for, so
 * it is the largest target on screen and never moves.
 *
 * Record is deliberately NOT a tab. It is a door to the capture surface on the root stack, so
 * pressing it never changes which tab is "current" — coming back from recording lands exactly
 * where the golfer left. The bar itself never hides (the standing no-vanishing-controls rule);
 * screens that must own their whole surface (the player, capture, profile) sit on the stack
 * above the tab navigator and cover it by construction.
 *
 * Glyphs are drawn `View`s like the rest of the deck — this app ships no icon font and no SVG
 * outside `design/gauges`.
 */

const LABELS: Record<string, string> = {
  Home: "Home",
  SwingLog: "Swings",
  Progress: "Progress",
  Coach: "Coach",
};

function TabIcon({ route, color }: { route: string; color: string }) {
  switch (route) {
    case "Home":
      return <HouseGlyph size={22} color={color} />;
    case "SwingLog":
      return <RowsGlyph size={22} color={color} />;
    case "Progress":
      return <BarsGlyph size={19} color={color} />;
    default:
      return <PersonGlyph size={22} color={color} />;
  }
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();

  const tab = (index: number) => {
    const route = state.routes[index];
    const focused = state.index === index;
    const color = focused ? t.accent : t.muted;
    const onPress = () => {
      // The standard tabPress contract: screens may preventDefault (none do today), and
      // re-pressing the current tab is a no-op rather than a re-push.
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
    };
    return (
      <Pressable
        key={route.key}
        testID={`tab-${route.name}`}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={LABELS[route.name] ?? route.name}
        onPress={onPress}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <TabIcon route={route.name} color={color} />
        <Text style={[styles.label, { color }]}>{LABELS[route.name] ?? route.name}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tab(0)}
      {tab(1)}
      <View style={styles.recordSlot}>
        <Pressable
          testID="tab-record"
          accessibilityRole="button"
          accessibilityLabel="Record a swing"
          onPress={() => navigation.navigate("Record" as never)}
          style={({ pressed }) => [styles.record, pressed && styles.recordPressed]}
        >
          <View style={styles.recordDot} />
        </Pressable>
        <Text style={styles.recordLabel}>Record</Text>
      </View>
      {tab(2)}
      {tab(3)}
    </View>
  );
}

const RECORD_SIZE = 62;

const useStyles = themedStyles((t) => ({
  bar: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: t.bg,
    paddingTop: 10,
    paddingHorizontal: 6,
  },
  tab: { flex: 1, alignItems: "center", gap: 5, paddingVertical: 2 },
  pressed: { opacity: 0.6 },
  label: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },

  recordSlot: { flex: 1.25, alignItems: "center", gap: 4 },
  record: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    marginTop: -(RECORD_SIZE / 2) + 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.accent,
    // A bg-coloured ring so the overhanging circle reads as floating over the content behind it.
    borderWidth: 5,
    borderColor: t.bg,
    elevation: 6,
  },
  recordPressed: { backgroundColor: t.accentPressed },
  recordDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.onAccent,
  },
  recordLabel: {
    color: t.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginTop: -2,
  },
}));
