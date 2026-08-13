import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { DECK } from "../../design/deck";
import type { PhaseBand } from "./phaseBands";

/**
 * The swing's phases as a hairline bar, drawn to scale in time.
 *
 * It is a *bar*, not a strip of pictures and not a row of labelled cells: the phase you are in is
 * named once, in the readout above it, so the bar itself only has to answer "how far through, and
 * how long is each part". That is what lets it be six points tall.
 *
 * Drawn to scale, **backswing against downswing is tempo** — the single most quoted number in
 * golf — which is the whole reason it earns any height at all. Equal-width segments would look
 * identical on a 3:1 swing and a 1:1 one.
 *
 * ## No gaps, ever
 *
 * Gaps are taken out of a row before flex divides what is left, so four 4pt gaps would push every
 * boundary up to 16pt away from the frame it marks — and the playhead, which maps the full width,
 * would cross a phase boundary at a visibly different moment from the picture behind it. The bands
 * butt together and are separated by a hairline drawn *inside* the band, which costs no width.
 */

export interface PhaseStripProps {
  bands: readonly PhaseBand[];
  /**
   * Screen weight per band, from `scrubMap` — the transport's ONE x↔frame mapping. The strip
   * must divide the row exactly as the scrub surface divides x, or a tap on a band boundary and
   * the playhead crossing it stop agreeing. Defaults to true durations when absent.
   */
  weights?: readonly number[];
  /** Index of the band the playhead is in; `-1` when it is outside all of them. */
  active: number;
  onSeek: (frame: number) => void;
  disabled?: boolean;
}

export const PhaseStrip = memo(function PhaseStrip({
  bands,
  weights,
  active,
  onSeek,
  disabled = false,
}: PhaseStripProps) {
  if (!bands.length) return null;

  return (
    <View style={styles.strip} testID="phase-strip">
      {bands.map((band, i) => {
        const span = band.to - band.from;
        const weight = weights?.[i] ?? span;
        return (
          <Pressable
            key={band.key}
            testID={`phase-${band.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${band.label}, ${span} frames`}
            accessibilityState={{ selected: i === active, disabled }}
            disabled={disabled}
            onPress={() => onSeek(band.from)}
            // Small drawing, full-size target: the bar is 6pt tall and the reachable area is not.
            hitSlop={{ top: 12, bottom: 12 }}
            style={{ flexGrow: weight, flexShrink: weight, flexBasis: 0 }}
          >
            <View
              style={[
                styles.band,
                { backgroundColor: band.color },
                // The analyzer's approach and run-out are padding, not swing. Dimmed so the eye
                // reads the three phases that are, without hiding that the padding is there.
                band.padding && styles.padding,
                i === active && styles.active,
              ]}
            />
            {i < bands.length - 1 ? <View style={styles.divider} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
});

const HEIGHT = 6;

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    // Clipped so the two end bands take the bar's rounded ends without either of them knowing it
    // is an end — which is what lets a zero-length phase be filtered out without leaving a square
    // corner behind.
    overflow: "hidden",
    backgroundColor: DECK.glass.key,
  },
  band: { height: HEIGHT, opacity: 0.75 },
  padding: { opacity: 0.28 },
  active: { opacity: 1 },
  divider: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 1,
    backgroundColor: DECK.glass.sheet,
  },
});
