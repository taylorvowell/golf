import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Analysis } from "@swingsage/schema/contract";

import { clubVariantOptions, defaultClubVar } from "../player/overlay/clubVariants";
import {
  DEFAULT_SMOOTHING,
  SMOOTHING_OPTIONS,
  type SmoothingKey,
} from "../player/overlay/traceSmoothing";

/**
 * The club-solution evaluation panel — `__DEV__` ONLY, opened from the flask orb in the
 * player's top-right chrome (Taylor, 2026-08-19: "an expandable menu on top right that stays
 * open and some column I can go and select different options").
 *
 * It exists because the debug SHEET closes on every tap and then waits a beat before acting —
 * right for forcing one state, exactly wrong for running through twenty club solutions. This
 * panel STAYS OPEN across picks; the host clears the drawn trace and replays the swing on each
 * one, so every option is seen drawing itself from address.
 *
 * Render-only selection, same contract as the web Debug Menu: switching solutions can never
 * change a score or metric, only the drawn line. The panel is an instrument, not product UI —
 * the caller gates it on `__DEV__`, and the winner's verdict retires it (the HANDOFF row).
 */

export interface VariantLabProps {
  analysis: Analysis;
  clubVar: string | null;
  smoothing: SmoothingKey | null;
  onPickClub: (key: string) => void;
  onPickSmoothing: (key: SmoothingKey) => void;
}

export function VariantLab({
  analysis,
  clubVar,
  smoothing,
  onPickClub,
  onPickSmoothing,
}: VariantLabProps) {
  const options = useMemo(() => clubVariantOptions(analysis), [analysis]);
  const picked = clubVar ?? defaultClubVar(analysis);
  const smoothed = smoothing ?? DEFAULT_SMOOTHING;

  return (
    <View style={styles.panel}>
      <View style={styles.solutionCol}>
        <Text style={styles.colTitle}>Solution</Text>
        <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {options.map((o) => {
            const cov = o.cov?.swing;
            const pct = typeof cov === "number" ? ` ${Math.round(cov * 100)}%` : "";
            const on = picked === o.key;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="button"
                accessibilityLabel={`Club solution ${o.key}`}
                accessibilityState={{ selected: on }}
                onPress={() => onPickClub(o.key)}
                style={[styles.row, on && styles.rowOn]}
              >
                <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>
                  {o.key}
                  {pct}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.smoothingCol}>
        <Text style={styles.colTitle}>Smoothing</Text>
        <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {SMOOTHING_OPTIONS.map((o) => {
            const on = smoothed === o.key;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="button"
                accessibilityLabel={`Trace smoothing ${o.key}`}
                accessibilityState={{ selected: on }}
                onPress={() => onPickSmoothing(o.key)}
                style={[styles.row, on && styles.rowOn]}
              >
                <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>
                  {o.key}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * Dev-instrument styling, hardcoded like the amber DEBUG tab: this panel must never be
 * mistaken for product chrome, and it can never reach a release build (`__DEV__` gate at the
 * call site), so it does not draw from the theme.
 */
const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    gap: 6,
    padding: 8,
    borderRadius: 14,
    backgroundColor: "rgba(8,14,18,0.92)",
    maxHeight: 360,
  },
  solutionCol: { width: 168 },
  smoothingCol: { width: 104 },
  colTitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  list: { flexGrow: 0 },
  row: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rowOn: { backgroundColor: "rgba(63,255,245,0.16)" },
  rowText: { color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: "600" },
  rowTextOn: { color: "#3FFFF5" },
});
