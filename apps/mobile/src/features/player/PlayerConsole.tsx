import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  BarsGlyph,
  ChevronGlyph,
  DECK,
  DeckButton,
  LoopGlyph,
  PauseGlyph,
  PlayGlyph,
} from "../../design/deck";
import { ScrubBar, SCRUB_TOUCH } from "./ScrubBar";
import { PhaseRibbon } from "./PhaseRibbon";
import { activeBand, type PhaseBand } from "./phaseBands";
import { frameToFraction, type Extent } from "./frames";
import type { FramePlayerActions, FramePlayerState } from "./useFramePlayer";

/**
 * The transport, floating over the picture.
 *
 * ## One x mapping, shared by everything that means a position
 *
 * The phase strip, the playhead, its frame badge and the scrub thumb all read the same fraction of
 * the same full-width box. That is why none of them is padded, gapped or inset: the moment two of
 * them disagree about where frame N is, the line crosses the boundary between backswing and
 * downswing at a visibly different instant from the picture behind it, and the strip stops being
 * believable. Anything added here either spans that box exactly or sits outside the group.
 *
 * ## Why the play button is the shape it is
 *
 * It is the only round cap on the dock and the only warm one, and both are for finding it without
 * looking. A golfer's eyes are on the swing, not on the phone, and shape survives being seen at the
 * edge of vision where a label does not.
 *
 * **Pause is play, pushed in.** Not a second icon on a second button — the same cap, latched down,
 * with the whole lighting model inverted (`DeckButton`). The transport's state is readable from the
 * *silhouette* in glare, when the glyph inside it has washed out. Two separate buttons could not do
 * that, and a button that changed colour would fail the same test colour always fails outdoors.
 *
 * ## The three dock groups are absolutely positioned
 *
 * The play cap is centred on the dock, not on the space left over between its neighbours. Laying
 * the three groups out in a row would move the transport sideways whenever a speed label or a
 * caption changed width, and the one control pressed without looking must not move.
 */

export interface PlayerConsoleProps {
  state: FramePlayerState;
  actions: FramePlayerActions;
  bounds: Extent;
  fps: number;
  /** Disabled when the swing has no frame count or rate — a transport that lies is worse than none. */
  seekable: boolean;
  /** The swing's phases, drawn to scale. Empty on a swing with no artifact — the strip then hides. */
  bands: readonly PhaseBand[];
  /** Opens the swing's numbers. */
  onMetrics: () => void;
  bottomInset?: number;
}

/**
 * Real time and three slow speeds.
 *
 * Quarter speed is the coaching one — at 60fps it presents a true 15 frames a second, slow enough
 * to watch the club through impact and still fast enough to read as motion. Tenth speed exists for
 * the transition, which is over in about four frames.
 */
const SPEEDS = [1, 0.5, 0.25, 0.1] as const;

const PLAY_DIAMETER = 54;
const DOCK_HEIGHT = 70;

export const PlayerConsole = memo(function PlayerConsole({
  state,
  actions,
  bounds,
  fps,
  seekable,
  bands,
  onMetrics,
  bottomInset = 0,
}: PlayerConsoleProps) {
  const disabled = !seekable || !!state.error;
  const { frame, playing, looping, speed } = state;

  const onSeek = useCallback((f: number) => actions.seekTo(f), [actions]);
  const fraction = frameToFraction(frame, bounds);
  const active = activeBand(bands, frame);

  const first = typeof bounds === "number" ? 0 : bounds.first;
  const last = typeof bounds === "number" ? Math.max(0, bounds - 1) : bounds.last;
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 0;

  return (
    // `box-none`: the scrim is a gradient over the picture, and the picture underneath it is still
    // the thing being watched. Only the controls themselves take touches.
    <View style={styles.scrim} pointerEvents="box-none" testID="player-console">
      <View style={styles.timeline} pointerEvents="box-none">
        <View style={styles.stepperRow} pointerEvents="box-none">
          <FrameStepper onStep={actions.step} disabled={disabled} />
        </View>

        {/* The one box every position reads from. Nothing inset, nothing gapped. */}
        <View style={styles.track}>
          <PhaseRibbon bands={bands} active={active} onSeek={onSeek} disabled={disabled} />
          <ScrubBar frame={frame} bounds={bounds} onSeek={onSeek} disabled={disabled} />

          {!disabled ? (
            <View
              testID="playhead"
              pointerEvents="none"
              style={[styles.playhead, { left: `${fraction * 100}%` }]}
            >
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{frame}</Text>
              </View>
              <View style={styles.playheadLine} />
            </View>
          ) : null}
        </View>

        <View style={styles.timeRow}>
          <Text style={styles.time}>{seconds(frame - first, rate)}</Text>
          <Text style={styles.time}>{seconds(last - first, rate)}</Text>
        </View>
      </View>

      <View style={[styles.dockWrap, { paddingBottom: 8 + bottomInset }]}>
        <View style={styles.dock}>
          <View style={styles.speedWell}>
            {SPEEDS.map((s) => (
              <Pressable
                key={s}
                testID={`speed-${String(s).replace(".", "-")}`}
                accessibilityRole="button"
                accessibilityLabel={`${formatSpeed(s)} speed`}
                accessibilityState={{ selected: speed === s, disabled }}
                disabled={disabled}
                onPress={() => actions.setSpeed(s)}
                style={[styles.speedKey, speed === s && styles.speedKeyOn]}
              >
                <Text style={[styles.speedText, speed === s && styles.speedTextOn]}>
                  {formatSpeed(s)}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* The one round cap, the one warm cap, and the only control anyone presses blind. */}
          <DeckButton
            testID="play-toggle"
            accessibilityLabel={playing ? "Pause" : "Play"}
            primary
            diameter={PLAY_DIAMETER}
            depressed={playing}
            disabled={disabled}
            onPress={actions.toggle}
            style={styles.playCap}
          >
            {playing ? (
              <PauseGlyph size={19} color={DECK.label.onPrimary} />
            ) : (
              <PlayGlyph size={20} color={DECK.label.onPrimary} />
            )}
          </DeckButton>

          <View style={styles.dockRight}>
            <DockAction
              testID="loop-toggle"
              label="Loop"
              on={looping}
              disabled={disabled}
              onPress={() => actions.setLooping(!looping)}
            >
              <LoopGlyph size={17} color={looping ? DECK.accent : DECK.label.caption} />
            </DockAction>

            <DockAction testID="metrics-open" label="Metrics" onPress={onMetrics}>
              <BarsGlyph size={16} color={DECK.label.caption} />
            </DockAction>
          </View>
        </View>
      </View>
    </View>
  );
});

/**
 * Frame stepping, as one pill of four flat keys.
 *
 * Flat rather than moulded caps: this sits over the picture, not on the dock, and four raised caps
 * up there would read as a second transport competing with the one below. Deck's rule is that a
 * cap is a *thing you press to make something happen now* — these adjust a position that is already
 * being shown a few points below them, which is why they borrow the strip's chrome instead.
 */
function FrameStepper({
  onStep,
  disabled,
}: {
  onStep: (delta: number) => void;
  disabled: boolean;
}) {
  const key = (id: string, delta: number, label: string, node: React.ReactNode) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onStep(delta)}
      hitSlop={{ top: 10, bottom: 10 }}
      style={({ pressed }) => [styles.stepKey, pressed && styles.stepKeyPressed]}
    >
      {node}
    </Pressable>
  );

  const chevron = (direction: "left" | "right") => (
    <ChevronGlyph size={6} weight={1.8} direction={direction} color={DECK.label.caption} />
  );
  const doubled = (direction: "left" | "right") => (
    <View style={styles.stepDouble}>
      {chevron(direction)}
      {chevron(direction)}
    </View>
  );

  return (
    <View style={[styles.stepper, disabled && styles.stepperDisabled]}>
      {key("step-back-10", -10, "Back ten frames", doubled("left"))}
      {key("step-back-1", -1, "Back one frame", chevron("left"))}
      <View style={styles.stepDivider} />
      {key("step-fwd-1", 1, "Forward one frame", chevron("right"))}
      {key("step-fwd-10", 10, "Forward ten frames", doubled("right"))}
    </View>
  );
}

/** A glyph over a caption — the dock's secondary controls. `on` lights it rather than filling it. */
function DockAction({
  testID,
  label,
  on,
  disabled,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  on?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on ?? false, disabled: disabled ?? false }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.dockAction, (pressed || disabled) && styles.dockActionDim]}
    >
      {children}
      <Text style={[styles.dockCaption, on && styles.dockCaptionOn]}>{label}</Text>
    </Pressable>
  );
}

/** `1×`, `½×`, `¼×`, `⅒×` — fractions rather than decimals, which read faster at this size. */
function formatSpeed(speed: number): string {
  const glyph: Record<string, string> = { "1": "1", "0.5": "½", "0.25": "¼", "0.1": "⅒" };
  return `${glyph[String(speed)] ?? String(speed)}×`;
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
    paddingTop: 64,
    experimental_backgroundImage: `linear-gradient(180deg, rgba(5,7,6,0) 0%, rgba(5,7,6,0.86) 42%, ${DECK.ground} 100%)`,
  },
  timeline: { paddingHorizontal: 20 },
  // Room above the strip for the playhead's badge to sit clear of it. Overlapping the badge onto
  // the strip hides the name of the phase it is standing in, which is the one it is naming.
  stepperRow: { flexDirection: "row", justifyContent: "flex-end", paddingBottom: 14 },
  track: { position: "relative" },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -2 },
  time: { color: DECK.label.quiet, fontSize: 10, fontVariant: ["tabular-nums"] },

  playhead: { position: "absolute", top: -13, bottom: SCRUB_TOUCH / 2, width: 2, marginLeft: -1, alignItems: "center" },
  playheadLine: { flex: 1, width: 2, backgroundColor: DECK.accent, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 12, spreadDistance: 0, color: "rgba(184,255,74,0.55)" }] },
  badge: { backgroundColor: DECK.accent, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: DECK.label.onPrimary, fontSize: 9, fontWeight: "900", fontVariant: ["tabular-nums"] },

  stepper: {
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DECK.glass.keyEdge,
    backgroundColor: DECK.glass.key,
    paddingHorizontal: 3,
  },
  stepperDisabled: { opacity: 0.35 },
  stepKey: { width: 34, height: 30, alignItems: "center", justifyContent: "center" },
  stepKeyPressed: { opacity: 0.5 },
  stepDouble: { flexDirection: "row", alignItems: "center", gap: 1 },
  stepDivider: { width: 1, height: 14, backgroundColor: DECK.glass.keyEdge },

  dockWrap: { paddingHorizontal: 16, paddingTop: 12 },
  dock: {
    height: DOCK_HEIGHT,
    borderRadius: DECK.radius.dock,
    borderWidth: 1,
    borderColor: DECK.glass.hairline,
    backgroundColor: DECK.glass.dock,
    boxShadow: DECK.shadow.float,
  },
  speedWell: {
    position: "absolute",
    left: 12,
    top: (DOCK_HEIGHT - 44) / 2,
    flexDirection: "row",
    alignItems: "center",
    width: 132,
    height: 44,
    borderRadius: 16,
    backgroundColor: DECK.glass.well,
    padding: 4,
    boxShadow: DECK.shadow.sunk,
  },
  speedKey: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center", borderRadius: 12 },
  speedKeyOn: { backgroundColor: "rgba(184,255,74,0.14)" },
  speedText: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700" },
  speedTextOn: { color: DECK.accent },

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
    gap: 2,
  },
  dockAction: { width: 46, height: 46, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 15 },
  dockActionDim: { opacity: 0.5 },
  dockCaption: {
    color: DECK.label.caption,
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  dockCaptionOn: { color: DECK.accent },
});
