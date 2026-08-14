import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { BarsGlyph, DECK, DeckButton, PauseGlyph, PlayGlyph, SparkGlyph } from "../../design/deck";
import { PhaseStrip } from "./PhaseStrip";
import { ScrubBar, SCRUB_TOUCH } from "./ScrubBar";
import { activeBand, scrubMap, type PhaseBand } from "./phaseBands";
import { type Extent } from "./frames";
import type { FramePlayerActions, FramePlayerState } from "./useFramePlayer";

/**
 * The transport, floating over the picture.
 *
 * ## Where you are is a NAME, not a picture
 *
 * The readout says `Downswing · 184`. That is the whole answer to "where am I", and it costs one
 * line of text — where a strip of thumbnails costs an artifact, a request, a decode and forty
 * points of the golfer's screen to say the same thing less precisely. The bar under it is six
 * points tall and only has to answer "how far through, and how long is each part".
 *
 * ## One x mapping, shared by everything that means a position
 *
 * The phase bar, the playhead and the scrub thumb all read the same fraction of the same
 * full-width box. That is why none of them is padded, gapped or inset: the moment two of them
 * disagree about where frame N is, the playhead crosses the backswing/downswing boundary at a
 * visibly different instant from the picture behind it, and the bar stops being believable.
 * `useSeekSurface` is the single copy of that arithmetic.
 *
 * ## Why the play button is the shape it is
 *
 * It is the only round cap on the dock and the only warm one, and both are for finding it without
 * looking. A golfer's eyes are on the swing, not on the phone, and shape survives being seen at the
 * edge of vision where a label does not.
 *
 * **Pause is play, pushed in.** Not a second icon on a second button — the same cap, latched down,
 * with the whole lighting model inverted (`DeckButton`). The transport's state is readable from the
 * *silhouette* in glare, when the glyph inside it has washed out.
 *
 * ## The three dock groups are absolutely positioned
 *
 * The play cap is centred on the dock, not on the space left over between its neighbours. Laying
 * the three groups out in a row would move the transport sideways whenever a label changed width,
 * and the one control pressed without looking must not move.
 */

export interface PlayerConsoleProps {
  state: FramePlayerState;
  actions: FramePlayerActions;
  bounds: Extent;
  fps: number;
  /** Disabled when the swing has no frame count or rate — a transport that lies is worse than none. */
  seekable: boolean;
  /** The swing's phases, drawn to scale. Empty on a swing with no artifact — the bar then hides. */
  bands: readonly PhaseBand[];
  onMetrics: () => void;
  onAnalysis: () => void;
  bottomInset?: number;
}

/**
 * Real time, half, and a tenth.
 *
 * Three, not four. Half is "the whole shape, slower" and a tenth is for the transition, which is
 * over in about four frames; a quarter sat between two speeds that already do their jobs and made
 * the segment narrow enough to mis-tap.
 */
const SPEEDS = [1, 0.5, 0.1] as const;

const PLAY_DIAMETER = 54;
const DOCK_HEIGHT = 70;
/** The speed well's inner geometry. Fixed, so the selection can slide to `index × SEGMENT`. */
const SEGMENT = 42;
const WELL_PAD = 4;

export const PlayerConsole = memo(function PlayerConsole({
  state,
  actions,
  bounds,
  fps,
  seekable,
  bands,
  onMetrics,
  onAnalysis,
  bottomInset = 0,
}: PlayerConsoleProps) {
  const disabled = !seekable || !!state.error;
  const { frame, playing, speed } = state;

  const onSeek = useCallback((f: number) => actions.seekTo(f), [actions]);
  // The drag's lifecycle drives the fast-scrub path: streamed seeks while the finger is down so
  // the picture keeps up, one exact landing on release. See useFramePlayer.beginScrub.
  const onScrubbingChange = useCallback(
    (scrubbing: boolean) => (scrubbing ? actions.beginScrub() : actions.endScrub()),
    [actions],
  );
  const active = activeBand(bands, frame);
  const here = active >= 0 ? bands[active].label : null;

  const first = typeof bounds === "number" ? 0 : bounds.first;
  const last = typeof bounds === "number" ? Math.max(0, bounds - 1) : bounds.last;
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 0;

  /**
   * The ONE x↔frame mapping every position on the transport reads — playhead, strip widths, fill
   * and touch surface. Weighted: the swing owns most of the bar, the analyzer's padding is
   * compressed (see `PADDING_SCRUB_WEIGHT`).
   */
  const map = useMemo(() => scrubMap(bands, { first, last }), [bands, first, last]);
  const fraction = map.toFraction(frame);

  return (
    // `box-none`: the scrim is a gradient over the picture, and the picture underneath it is still
    // the thing being watched. Only the controls themselves take touches.
    <View style={styles.scrim} pointerEvents="box-none" testID="player-console">
      <View style={styles.timeline} pointerEvents="box-none">
        <View style={styles.readout}>
          <Text testID="position-readout" style={styles.where} numberOfLines={1}>
            {here ? <Text style={styles.wherePhase}>{here}</Text> : null}
            {here ? "  " : null}
            <Text style={styles.whereFrame}>{frame}</Text>
          </Text>
          <Text style={styles.time}>
            {seconds(frame - first, rate)}
            <Text style={styles.timeTotal}> / {seconds(last - first, rate)}</Text>
          </Text>
        </View>

        {/* The one box every position reads from. Nothing inset, nothing gapped. */}
        <View style={styles.track}>
          <PhaseStrip
            bands={bands}
            weights={map.weights}
            active={active}
            onSeek={onSeek}
            disabled={disabled}
          />
          <ScrubBar
            frame={frame}
            bounds={bounds}
            map={map}
            fps={fps}
            onSeek={onSeek}
            onScrubbingChange={onScrubbingChange}
            disabled={disabled}
          />

          {!disabled ? (
            <View
              testID="playhead"
              pointerEvents="none"
              style={[styles.playhead, { left: `${fraction * 100}%` }]}
            />
          ) : null}
        </View>
      </View>

      <Dock
        playing={playing}
        speed={speed}
        disabled={disabled}
        onToggle={actions.toggle}
        onSpeed={actions.setSpeed}
        onMetrics={onMetrics}
        onAnalysis={onAnalysis}
        bottomInset={bottomInset}
      />
    </View>
  );
});

/**
 * The dock, behind its own memo boundary, taking only primitives and stable callbacks.
 *
 * The console above it re-renders on every presented frame — `frame` is in the readout and the
 * playhead, so it must. Nothing in the dock changes at 60Hz, and without this boundary the speed
 * well, the play cap and both dock actions reconciled once per frame for a readout they do not
 * contain. Primitives rather than the `state` object, because an object prop whose identity
 * changes per frame is what defeats a memo in the first place.
 */
const Dock = memo(function Dock({
  playing,
  speed,
  disabled,
  onToggle,
  onSpeed,
  onMetrics,
  onAnalysis,
  bottomInset,
}: {
  playing: boolean;
  speed: number;
  disabled: boolean;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onMetrics: () => void;
  onAnalysis: () => void;
  bottomInset: number;
}) {
  return (
    <View style={[styles.dockWrap, { paddingBottom: 8 + bottomInset }]}>
      <View style={styles.dock}>
        <SpeedSlider speed={speed} disabled={disabled} onChange={onSpeed} />

        {/* The one round cap, the one warm cap, and the only control anyone presses blind. */}
        <DeckButton
          testID="play-toggle"
          accessibilityLabel={playing ? "Pause" : "Play"}
          primary
          diameter={PLAY_DIAMETER}
          depressed={playing}
          disabled={disabled}
          onPress={onToggle}
          style={styles.playCap}
        >
          {playing ? (
            <PauseGlyph size={19} color={DECK.label.onPrimary} />
          ) : (
            <PlayGlyph size={20} color={DECK.label.onPrimary} />
          )}
        </DeckButton>

        <View style={styles.dockRight}>
          <DockAction testID="metrics-open" label="Metrics" onPress={onMetrics}>
            <BarsGlyph size={16} color={DECK.label.caption} />
          </DockAction>
          <DockAction testID="analysis-open" label="Analysis" accent onPress={onAnalysis}>
            <SparkGlyph size={17} color={DECK.accent} />
          </DockAction>
        </View>
      </View>
    </View>
  );
});

/**
 * Speed, as a segmented slider.
 *
 * The lit pill *slides* between segments rather than cutting, and that is the only reason it is
 * animated: a transport control that jumped would read as the layout changing rather than as a
 * setting moving. It is `translateX` on the native driver, so it never touches the JS thread the
 * overlay is drawing on.
 *
 * Segments are a fixed width, so the pill's position is `index × SEGMENT` with nothing to measure
 * — no layout pass, and no first-render frame with the pill in the wrong place.
 */
function SpeedSlider({
  speed,
  disabled,
  onChange,
}: {
  speed: number;
  disabled: boolean;
  onChange: (speed: number) => void;
}) {
  const index = Math.max(0, SPEEDS.indexOf(speed as (typeof SPEEDS)[number]));
  const slide = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: index,
      damping: 22,
      stiffness: 280,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [index, slide]);

  return (
    <View style={[styles.well, disabled && styles.dim]}>
      <Animated.View
        style={[
          styles.wellPill,
          {
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, SPEEDS.length - 1],
                  outputRange: [0, SEGMENT * (SPEEDS.length - 1)],
                }),
              },
            ],
          },
        ]}
      />
      {SPEEDS.map((s) => (
        <Pressable
          key={s}
          testID={`speed-${String(s).replace(".", "-")}`}
          accessibilityRole="button"
          accessibilityLabel={`${formatSpeed(s)} speed`}
          accessibilityState={{ selected: speed === s, disabled }}
          disabled={disabled}
          onPress={() => onChange(s)}
          style={styles.segment}
        >
          <Text style={[styles.segmentText, speed === s && styles.segmentTextOn]}>
            {formatSpeed(s)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A glyph over a caption — the dock's secondary controls. Equal width, so the pair reads as one. */
function DockAction({
  testID,
  label,
  accent,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  accent?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.dockAction, pressed && styles.dim]}
    >
      {children}
      <Text style={[styles.dockCaption, accent && styles.dockCaptionOn]}>{label}</Text>
    </Pressable>
  );
}

/** `1x`, `0.5x`, `0.1x`. Plain decimals — a fraction glyph is a font risk for no gain. */
export function formatSpeed(speed: number): string {
  return `${speed}x`;
}

/**
 * Seconds to two decimals, not `m:ss`.
 *
 * A golf swing is about a second and a half end to end, so minute:second resolution would print
 * `0:01` across the whole of it. The clip is short enough that the decimal IS the readable form.
 */
function seconds(frames: number, fps: number): string {
  if (fps <= 0) return "—";
  return `${Math.max(0, frames / fps).toFixed(2)}s`;
}

const styles = StyleSheet.create({
  scrim: {
    paddingTop: 72,
    experimental_backgroundImage: `linear-gradient(180deg, rgba(5,7,6,0) 0%, rgba(5,7,6,0.86) 42%, ${DECK.ground} 100%)`,
  },
  timeline: { paddingHorizontal: 20 },
  readout: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 7,
  },
  where: { flexShrink: 1 },
  wherePhase: { color: DECK.label.onFace, fontSize: 13, fontWeight: "700", letterSpacing: -0.2 },
  whereFrame: { color: DECK.accent, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  time: { color: DECK.label.quiet, fontSize: 11, fontVariant: ["tabular-nums"] },
  timeTotal: { color: DECK.label.dim },

  track: { position: "relative" },
  // Terminates at the scrub thumb, which sits at `SCRUB_TOUCH / 2` from that view's top. No badge:
  // the frame number is in the readout, and a second copy riding the line cost 13pt of headroom to
  // say the same thing.
  playhead: {
    position: "absolute",
    top: -3,
    bottom: SCRUB_TOUCH / 2,
    width: 2,
    marginLeft: -1,
    backgroundColor: DECK.accent,
    boxShadow: [
      { offsetX: 0, offsetY: 0, blurRadius: 10, spreadDistance: 0, color: "rgba(184,255,74,0.5)" },
    ],
  },

  dockWrap: { paddingHorizontal: 16, paddingTop: 10 },
  dock: {
    height: DOCK_HEIGHT,
    borderRadius: DECK.radius.dock,
    backgroundColor: DECK.glass.dock,
    boxShadow: DECK.shadow.float,
  },
  dim: { opacity: 0.5 },

  well: {
    position: "absolute",
    left: 12,
    top: (DOCK_HEIGHT - 44) / 2,
    flexDirection: "row",
    alignItems: "center",
    width: SEGMENT * SPEEDS.length + WELL_PAD * 2,
    height: 44,
    borderRadius: 15,
    padding: WELL_PAD,
    backgroundColor: DECK.glass.well,
    boxShadow: DECK.shadow.sunk,
  },
  wellPill: {
    position: "absolute",
    left: WELL_PAD,
    top: WELL_PAD,
    width: SEGMENT,
    height: 44 - WELL_PAD * 2,
    borderRadius: 11,
    backgroundColor: "rgba(184,255,74,0.16)",
  },
  segment: { width: SEGMENT, height: "100%", alignItems: "center", justifyContent: "center" },
  segmentText: { color: DECK.label.caption, fontSize: 11.5, fontWeight: "700" },
  segmentTextOn: { color: DECK.accent },

  playCap: {
    position: "absolute",
    left: "50%",
    top: (DOCK_HEIGHT - PLAY_DIAMETER) / 2,
    marginLeft: -PLAY_DIAMETER / 2,
  },

  dockRight: {
    position: "absolute",
    right: 12,
    top: (DOCK_HEIGHT - 46) / 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dockAction: { width: 52, height: 46, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 15 },
  dockCaption: {
    color: DECK.label.caption,
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  dockCaptionOn: { color: DECK.accent },
});
