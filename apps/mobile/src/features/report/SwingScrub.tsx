import { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { stepFrame, type Extent } from "../player/frames";
import type { PhaseBand, ScrubMap } from "../player/phaseBands";
import { useSeekSurface } from "../player/useSeekSurface";

/**
 * `.report-v2-swing-map` — the report's phase-labelled scrub: five phase blocks with the
 * mockup's fills, under a full-width playback line whose filled portion reads the position, a
 * white dot indicator with an aqua halo riding that line, and one touch surface over the lot.
 *
 * The line is always there; the PHASES are not. While a swing analyses there is nothing to name,
 * so the control is just its line, and the phase row grows in underneath it once detection
 * finishes (Taylor, step-03 iteration) — the pill gets taller rather than the blocks appearing
 * between two frames.
 *
 * Segment widths come from `map.weights` — the transport's ONE x↔frame mapping (`scrubMap`),
 * shared with the touch surface and the indicator. The mockup's 14/30/18/10/18 columns are
 * placeholder numbers; the real artifact's phase durations replace them. The mockup's 2px
 * column gap is drawn as an inset margin INSIDE each segment rather than as layout `gap`:
 * flex divides the full row exactly as the touch surface divides x, so a tap on a drawn
 * boundary and the indicator crossing it agree to the pixel (the PhaseStrip no-gaps rule).
 *
 * The labels are the mockup's five (`Address / Backswing / Approach / Impact / Finish`)
 * mapped onto the artifact's band vocabulary — same spans the player's strip draws, new
 * names on top.
 */

export interface SwingScrubProps {
  bands: readonly PhaseBand[];
  /** The one x↔frame mapping (weights included). Must be built from the same `bands`. */
  map: ScrubMap;
  bounds: Extent;
  frame: number;
  /** For the spoken position — the unit a golfer works in is the frame. */
  fps?: number;
  onSeek: (frame: number) => void;
  /** Touch-down / release — drives the transport's fast-scrub path. */
  onScrubbingChange?: (scrubbing: boolean) => void;
  disabled?: boolean;
  /**
   * False when the heard strike and the measured Impact describe different moments.
   *
   * The phases still draw — they are the only description of this swing there is, and hiding
   * them would leave the golfer with less, not with less that is wrong. They draw DIMMED, which
   * is the same thing the overlay does to a low-confidence keypoint and for the same reason:
   * uncertain findings are never presented as fact.
   */
  confirmed?: boolean;
}

/** The mockup's `.report-v2-phase.*` skins, keyed by the artifact band they dress. */
const PHASE_SKIN: Record<PhaseBand["key"], { label: string; fill: string; ink: string }> = {
  setup: { label: "Address", fill: "rgba(255,255,255,0.14)", ink: "rgba(255,255,255,0.88)" },
  backswing: { label: "Backswing", fill: "rgba(47,70,207,0.88)", ink: "rgba(255,255,255,0.88)" },
  downswing: { label: "Approach", fill: "rgba(67,205,208,0.84)", ink: "#07213E" },
  through: { label: "Impact", fill: "rgba(247,201,72,0.96)", ink: "#3A2A00" },
  runout: { label: "Finish", fill: "rgba(40,168,107,0.9)", ink: "rgba(255,255,255,0.88)" },
};

export const SwingScrub = memo(function SwingScrub({
  bands,
  map,
  bounds,
  frame,
  fps = 0,
  onSeek,
  onScrubbingChange,
  disabled = false,
  confirmed = true,
}: SwingScrubProps) {
  const surface = useSeekSurface(map.toFrame, onSeek, disabled, onScrubbingChange);

  /**
   * The phases ARRIVE — they do not appear (Taylor, step-03 iteration). While a swing analyses
   * the row is a single placeholder; the moment the artifact lands, five labelled blocks would
   * otherwise replace it between two frames, which reads as a glitch rather than as a result.
   * One native-driven value on the row: nothing per-band, nothing on the 60 Hz path.
   */
  const arrive = useRef(new Animated.Value(bands.length ? 1 : 0)).current;
  const arrived = useRef(bands.length > 0);
  useEffect(() => {
    if (!bands.length || arrived.current) return;
    arrived.current = true;
    Animated.timing(arrive, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      // Height cannot go through the native driver. This runs ONCE per swing, off the 60 Hz
      // path, and the alternative (a fixed-height row that fakes growth with translate) leaves
      // the pill the wrong size before the artifact lands.
      useNativeDriver: false,
    }).start();
  }, [arrive, bands.length]);
  const fraction = map.toFraction(frame);

  const spoken =
    fps > 0 ? `frame ${frame}, ${(frame / fps).toFixed(2)} seconds` : `frame ${frame}`;

  return (
    <View
      testID="swing-scrub"
      style={[styles.touch, disabled && styles.dim]}
      onLayout={surface.onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Swing position"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        // Said out loud, because dimming is invisible to a screen reader and this is exactly the
        // kind of thing a golfer would want to know before trusting a phase boundary.
        text: confirmed ? spoken : `${spoken}. Swing phases are approximate`,
      }}
      accessibilityActions={ADJUST_ACTIONS}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        if (e.nativeEvent.actionName === "increment") onSeek(stepFrame(frame, 1, bounds));
        if (e.nativeEvent.actionName === "decrement") onSeek(stepFrame(frame, -1, bounds));
      }}
      {...surface.panHandlers}
    >
      {/* Before the artifact lands there is nothing to name, so the control is a plain line with
          everything left of the handle filled. It does not sit ABOVE the phases — it BECOMES
          them: as the phase row grows in from below, the line collapses into it, so the golfer
          sees one control get taller rather than a second one appear.

          EVERY child is `pointerEvents="none"`: the seek surface derives its origin from the
          grant's `locationX`, which is relative to the DEEPEST view touched — a tap landing on
          a phase block measured against that block, and every tap seeked to the start of the
          bar (Taylor, 2026-08-19). The surface itself must be the only touch target. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.track,
          {
            height: arrive.interpolate({ inputRange: [0, 1], outputRange: [LINE_HEIGHT, 0] }),
            opacity: arrive.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0, 0] }),
          },
        ]}
      >
        <View style={[styles.trackFill, { width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }]} />
      </Animated.View>

      {/* The phases arrive FROM BELOW and push the control taller (Taylor, step-03 iteration). */}
      <Animated.View
        pointerEvents="none"
        style={{
          height: arrive.interpolate({ inputRange: [0, 1], outputRange: [0, MAP_HEIGHT] }),
          opacity: arrive,
          overflow: "hidden",
        }}
      >
        {/* Drawn QUIETER, never differently and never not at all, when the heard strike and the
            measured Impact describe different moments. The phases are still the only account of
            this swing there is — replacing them with nothing leaves the golfer with less, not
            with less that is wrong — so this is the overlay's low-confidence treatment applied
            to a band instead of a keypoint. */}
        <View style={[styles.mapRow, !confirmed && styles.unconfirmed]}>
          {bands.map((band, i) => {
            const skin = PHASE_SKIN[band.key];
            const weight = map.weights[i] ?? band.to - band.from;
            return (
              <View
                key={band.key}
                testID={`swing-scrub-${band.key}`}
                style={{ flexGrow: weight, flexShrink: weight, flexBasis: 0 }}
              >
                <View style={[styles.phase, { backgroundColor: skin.fill }]}>
                  {/* .report-v2-phase::before — the quiet top strip. */}
                  <View style={styles.phaseTop} />
                  <Text numberOfLines={1} style={[styles.phaseLabel, { color: skin.ink }]}>
                    {skin.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </Animated.View>

      {/* .report-v2-swing-indicator — white dot in an aqua halo, riding the playback line. */}
      {!disabled ? (
        <View
          testID="swing-scrub-indicator"
          pointerEvents="none"
          style={[styles.indicator, { left: `${fraction * 100}%` }]}
        >
          <View style={styles.halo}>
            <View style={styles.dot} />
          </View>
          {/* Once the stages are up the handle is a LINE through them with the ball at its head
              (Taylor, step-03 iteration). The column is centred, so growing the stem to the
              stage row's height lifts the ball to exactly the row's top edge — the handle
              re-shapes itself with no second animation to keep in step. */}
          <Animated.View
            style={[
              styles.stem,
              {
                height: arrive.interpolate({ inputRange: [0, 1], outputRange: [0, MAP_HEIGHT] }),
                opacity: arrive,
              },
            ]}
          />

        </View>
      ) : null}
    </View>
  );
});

const ADJUST_ACTIONS = [{ name: "increment" }, { name: "decrement" }] as const;

/**
 * Map height. The mockup's 34 was drawn for a card of its own; inside the shared transport pill
 * (Taylor, step-03 iteration) the scrub is one band of a control, not a panel, so it comes down
 * to 26 — still tall enough for the phase labels to sit under the quiet top strip.
 */
const MAP_HEIGHT = 26;
/** The pre-analysis line. It collapses to nothing as the phase row takes its place. */
const LINE_HEIGHT = 5;
const TOUCH_PAD = 4;
const DOT = 14;
const HALO = 22;

const styles = StyleSheet.create({
  touch: { paddingVertical: TOUCH_PAD, justifyContent: "center", overflow: "visible" },
  /** The two witnesses disagree. Faded, not hidden, not recoloured. */
  unconfirmed: { opacity: 0.45 },
  dim: { opacity: 0.5 },
  mapRow: { flexDirection: "row", height: MAP_HEIGHT },
  phase: {
    flex: 1,
    marginHorizontal: 1, // the mockup's 2px gap, drawn inside the exact flex division
    borderRadius: 9,
    overflow: "hidden",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 3,
  },
  phaseTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  phaseLabel: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 6,
    letterSpacing: 0.48,
    textTransform: "uppercase",
  },
  // The line, and how far through the swing the playhead is. Short on purpose — it is a
  // position readout, not a surface.
  track: {
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  trackFill: { height: LINE_HEIGHT, borderRadius: 3, backgroundColor: "#43CDD0" },
  // Centred on WHATEVER the control currently is — the thin line before the artifact lands, the
  // phase row after. Spanning the full height and centring both ways means the handle needs no
  // animation of its own to follow the growth.
  indicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // The indicator column is a zero-width line at the playhead's x; `alignItems: "center"`
  // centres the halo on it, the mockup's `translateX(-50%)`.
  halo: {
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(67,205,208,0.24)",
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: "#FFFFFF",
  },
  stem: { width: 2, borderRadius: 1, backgroundColor: "#FFFFFF" },
});
