import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DECK } from "../../design/deck";
import type { PhaseBand } from "./phaseBands";

/**
 * The swing's phases as a strip, drawn to scale in time.
 *
 * ## The depth falloff is the design's, applied to real data
 *
 * The screen this came from shows a film wheel whose cells recede as they get further from the
 * playhead. That effect is kept exactly — the band under the playhead is full strength, its
 * neighbours dim and flatten, the far ends nearly vanish — but it is applied to phases rather than
 * frames, so what recedes is *the part of the swing you are not watching*.
 *
 * It flattens by `scaleY` alone, never uniformly. A uniform scale would shrink a band's width, and
 * this strip's width is its meaning: the playhead, the phase boundaries and the scrub thumb all
 * read from one x mapping, and a band that changed width under the playhead would slide the
 * boundary out from under it.
 *
 * ## No gaps between the bands, on purpose
 *
 * Gaps are taken out of the row before flex divides what is left, so four 4pt gaps would push
 * every boundary up to 16pt away from the frame it marks — and the playhead, which maps the full
 * width, would cross a boundary at a visibly different moment from the picture. The bands butt
 * together and are separated by a hairline drawn *inside* the band, which costs no width.
 */

export interface PhaseRibbonProps {
  bands: readonly PhaseBand[];
  /** Index of the band the playhead is in; `-1` when it is outside all of them. */
  active: number;
  onSeek: (frame: number) => void;
  disabled?: boolean;
}

/** Opacity and vertical squash by distance from the active band. Index 3 is "and everything past". */
const FALLOFF = [
  { opacity: 1, scaleY: 1 },
  { opacity: 0.78, scaleY: 0.94 },
  { opacity: 0.5, scaleY: 0.88 },
  { opacity: 0.3, scaleY: 0.82 },
] as const;

/** Below this share of the strip a band has no room for its name; below the second, none for either. */
const LABEL_MIN = 0.13;
const DURATION_MIN = 0.075;

export const PhaseRibbon = memo(function PhaseRibbon({
  bands,
  active,
  onSeek,
  disabled = false,
}: PhaseRibbonProps) {
  if (!bands.length) return null;
  const total = bands.reduce((sum, b) => sum + (b.to - b.from), 0);
  if (total <= 0) return null;

  return (
    <View style={styles.strip} testID="phase-ribbon">
      {bands.map((band, i) => {
        const span = band.to - band.from;
        const share = span / total;
        const step = active < 0 ? 1 : Math.min(Math.abs(i - active), FALLOFF.length - 1);
        const { opacity, scaleY } = FALLOFF[step];
        const lit = i === active;

        return (
          <Pressable
            key={band.key}
            testID={`phase-${band.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${band.label}, ${span} frames`}
            accessibilityState={{ selected: lit, disabled }}
            disabled={disabled}
            onPress={() => onSeek(band.from)}
            style={({ pressed }) => [
              styles.band,
              { flexGrow: span, flexShrink: span, flexBasis: 0, opacity: pressed ? 0.7 : opacity },
              { transform: [{ scaleY }] },
            ]}
          >
            {/* The face is a wash of the band's own colour rather than the colour itself: a solid
                violet block next to a solid cyan one competes with the trace it is naming. */}
            <View
              style={[
                styles.face,
                {
                  // Stops kept inside 0–100%: a stop past 100 is legal CSS and is not parsed the
                  // same way here, and the failure is a band that renders flat black.
                  experimental_backgroundImage: `linear-gradient(180deg, ${band.color} 0%, rgba(0,0,0,0.55) 100%)`,
                },
                band.padding && styles.facePad,
                lit && styles.faceLit,
              ]}
            />
            {i < bands.length - 1 ? <View style={styles.divider} /> : null}

            {share >= LABEL_MIN ? (
              <Text numberOfLines={1} style={[styles.label, lit && styles.labelLit]}>
                {band.label}
              </Text>
            ) : null}
            {share >= DURATION_MIN ? (
              <Text style={[styles.duration, lit && styles.durationLit]}>{span}f</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
});

const HEIGHT = 46;

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    height: HEIGHT,
    borderRadius: 14,
    // Clipped so the two end bands take the strip's corners without either of them knowing it is
    // an end — which is what lets a band be filtered out (a zero-length phase) without leaving a
    // square corner behind.
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  band: { height: HEIGHT, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 2 },
  face: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  facePad: { opacity: 0.5 },
  faceLit: { opacity: 1 },
  divider: { position: "absolute", top: 0, right: 0, bottom: 0, width: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  label: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  labelLit: { color: "#fff" },
  duration: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  durationLit: { color: DECK.accent },
});
