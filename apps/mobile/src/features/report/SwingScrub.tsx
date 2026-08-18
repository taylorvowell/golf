import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { stepFrame, type Extent } from "../player/frames";
import type { PhaseBand, ScrubMap } from "../player/phaseBands";
import { useSeekSurface } from "../player/useSeekSurface";

/**
 * `.report-v2-swing-map` — the report's phase-labelled scrub: five phase blocks with the
 * mockup's fills, a white dot indicator with an aqua halo and a stem below it, and one
 * full-width touch surface over the lot.
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
}: SwingScrubProps) {
  const surface = useSeekSurface(map.toFrame, onSeek, disabled, onScrubbingChange);
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
      accessibilityValue={{ text: spoken }}
      accessibilityActions={ADJUST_ACTIONS}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        if (e.nativeEvent.actionName === "increment") onSeek(stepFrame(frame, 1, bounds));
        if (e.nativeEvent.actionName === "decrement") onSeek(stepFrame(frame, -1, bounds));
      }}
      {...surface.panHandlers}
    >
      <View style={styles.mapRow}>
        {bands.length ? (
          bands.map((band, i) => {
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
          })
        ) : (
          /* No artifact → no phases to name. One honest neutral block; the scrub still works. */
          <View style={{ flex: 1 }}>
            <View style={[styles.phase, { backgroundColor: PHASE_SKIN.setup.fill }]} />
          </View>
        )}
      </View>

      {/* .report-v2-swing-indicator — white dot in an aqua halo, stem to the map's foot. */}
      {!disabled ? (
        <View
          testID="swing-scrub-indicator"
          pointerEvents="none"
          style={[styles.indicator, { left: `${fraction * 100}%` }]}
        >
          <View style={styles.halo}>
            <View style={styles.dot} />
          </View>
          <View style={styles.stem} />
        </View>
      ) : null}
    </View>
  );
});

const ADJUST_ACTIONS = [{ name: "increment" }, { name: "decrement" }] as const;

/** Map height per the mockup; the touch surface adds the mockup's -6px range inset per side. */
const MAP_HEIGHT = 34;
const TOUCH_PAD = 6;
const DOT = 14;
const HALO = 22;

const styles = StyleSheet.create({
  touch: { paddingVertical: TOUCH_PAD, justifyContent: "center" },
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
    paddingBottom: 6,
  },
  phaseTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  phaseLabel: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 6,
    letterSpacing: 0.48,
    textTransform: "uppercase",
  },
  indicator: {
    position: "absolute",
    top: TOUCH_PAD - 4,
    bottom: TOUCH_PAD - 4,
    width: 0,
    alignItems: "center",
  },
  // The indicator column is a zero-width line at the playhead's x; `alignItems: "center"`
  // centres the halo and the stem on it, the mockup's `translateX(-50%)`.
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
  stem: {
    position: "absolute",
    top: HALO - 4,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    left: "50%",
    borderRadius: 99,
    backgroundColor: "#FFFFFF",
  },
});
