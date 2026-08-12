import { memo, useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  DECK,
  DeckButton,
  DeckRow,
  DeckSurface,
  DeckToggle,
  LoopGlyph,
  PauseGlyph,
  PlayGlyph,
  StepGlyph,
} from "../../design/deck";
import { COLORS } from "../../theme";
import { ScrubBar } from "./ScrubBar";
import { formatPosition, type Extent } from "./frames";
import type { FramePlayerActions, FramePlayerState } from "./useFramePlayer";

/**
 * The transport, as a control surface.
 *
 * ## Why the play button is the shape it is
 *
 * It is the only round cap on the deck and the only warm one, and both are for finding it without
 * looking. A golfer's eyes are on the swing, not on the phone, and shape survives being seen at the
 * edge of vision where a label does not. Everything else on this surface is a rounded rectangle
 * precisely so that one thing is not.
 *
 * **Pause is play, pushed in.** Not a second icon on a second button — the same cap, latched down,
 * with the whole lighting model inverted (`DeckButton`). That means the transport's state is
 * readable from the *silhouette* in glare, when the glyph inside it has washed out. Two separate
 * buttons could not do that, and a button that changed colour would fail the same test colour
 * always fails outdoors.
 *
 * ## Every press pulls the picture back
 *
 * `onInteract` fires before the action itself. Driving a transport you cannot see is the one way
 * this screen can waste a golfer's time completely, so touching any control scrolls the video back
 * into view first. It is deliberately not debounced or conditional: the cost of a redundant scroll
 * is nothing, and the cost of the one that did not happen is a control that appears dead.
 */

export interface PlayerConsoleProps {
  state: FramePlayerState;
  actions: FramePlayerActions;
  bounds: Extent;
  fps: number;
  /** Disabled when the swing has no frame count or rate — a transport that lies is worse than none. */
  seekable: boolean;
  /** Fires on ANY control touch, before the control acts. Scrolls the video back into view. */
  onInteract: () => void;
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

const PLAY_DIAMETER = 78;

export const PlayerConsole = memo(function PlayerConsole({
  state,
  actions,
  bounds,
  fps,
  seekable,
  onInteract,
  bottomInset = 0,
}: PlayerConsoleProps) {
  const disabled = !seekable || !!state.error;

  /** Wrap a control's action so the picture comes back into view before it runs. */
  const guard = useCallback(
    (fn: () => void) => () => {
      onInteract();
      fn();
    },
    [onInteract],
  );

  const onSeek = useCallback(
    (frame: number) => {
      onInteract();
      actions.seekTo(frame);
    },
    [actions, onInteract],
  );

  return (
    <DeckSurface testID="player-console" bottomInset={bottomInset}>
      <View>
        <ScrubBar
          frame={state.frame}
          bounds={bounds}
          onSeek={onSeek}
          disabled={disabled}
        />
        <View style={styles.readoutRow}>
          <Text testID="position-readout" style={styles.readout}>
            {formatPosition(state.frame, fps)}
          </Text>
          {state.speed !== 1 ? (
            <Text style={styles.readoutSpeed}>{formatSpeed(state.speed)}</Text>
          ) : null}
        </View>
      </View>

      <DeckRow gap={10}>
        <DeckButton
          testID="step-back-10"
          accessibilityLabel="Back ten frames"
          disabled={disabled}
          onPress={guard(() => actions.step(-10))}
          grow={1}
        >
          <View style={styles.stepGlyphRow}>
            <StepGlyph size={13} color={DECK.label.onFace} back />
            <Text style={styles.stepCount}>10</Text>
          </View>
        </DeckButton>

        <DeckButton
          testID="step-back-1"
          accessibilityLabel="Back one frame"
          disabled={disabled}
          onPress={guard(() => actions.step(-1))}
          grow={1}
        >
          <StepGlyph size={15} color={DECK.label.onFace} back />
        </DeckButton>

        {/* The one round cap, the one warm cap, and the only control anyone presses blind. */}
        <DeckButton
          testID="play-toggle"
          accessibilityLabel={state.playing ? "Pause" : "Play"}
          primary
          diameter={PLAY_DIAMETER}
          depressed={state.playing}
          disabled={disabled}
          onPress={guard(() => actions.toggle())}
          style={styles.playCap}
        >
          {state.playing ? (
            <PauseGlyph size={26} color={DECK.label.onPrimary} />
          ) : (
            <PlayGlyph size={28} color={DECK.label.onPrimary} />
          )}
        </DeckButton>

        <DeckButton
          testID="step-fwd-1"
          accessibilityLabel="Forward one frame"
          disabled={disabled}
          onPress={guard(() => actions.step(1))}
          grow={1}
        >
          <StepGlyph size={15} color={DECK.label.onFace} />
        </DeckButton>

        <DeckButton
          testID="step-fwd-10"
          accessibilityLabel="Forward ten frames"
          disabled={disabled}
          onPress={guard(() => actions.step(10))}
          grow={1}
        >
          <View style={styles.stepGlyphRow}>
            <Text style={styles.stepCount}>10</Text>
            <StepGlyph size={13} color={DECK.label.onFace} />
          </View>
        </DeckButton>
      </DeckRow>

      <DeckRow gap={8}>
        <DeckButton
          testID="loop-toggle"
          accessibilityLabel="Loop the swing"
          depressed={state.looping}
          disabled={disabled}
          onPress={guard(() => actions.setLooping(!state.looping))}
          grow={1.2}
        >
          <LoopGlyph size={20} color={state.looping ? DECK.label.engaged : DECK.label.onFace} />
        </DeckButton>

        {/* Speeds latch like everything else, so "which speed am I on" is answered by which cap is
            in — readable in glare, where four similar labels are not. */}
        {SPEEDS.map((s) => (
          <DeckToggle
            key={s}
            testID={`speed-${String(s).replace(".", "-")}`}
            accessibilityLabel={`${formatSpeed(s)} speed`}
            label={formatSpeed(s)}
            on={state.speed === s}
            disabled={disabled}
            onPress={guard(() => actions.setSpeed(s))}
          />
        ))}
      </DeckRow>
    </DeckSurface>
  );
});

/** `1×`, `½×`, `¼×`, `⅒×` — fractions rather than decimals, which read faster at this size. */
function formatSpeed(speed: number): string {
  const glyph: Record<string, string> = { "1": "1", "0.5": "½", "0.25": "¼", "0.1": "⅒" };
  return `${glyph[String(speed)] ?? String(speed)}×`;
}

const styles = StyleSheet.create({
  readoutRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  readout: { color: COLORS.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  readoutSpeed: { color: COLORS.acid, fontSize: 12, fontWeight: "700" },
  stepGlyphRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  stepCount: { color: DECK.label.dim, fontSize: 11, fontWeight: "700" },
  // Pulled up out of the row so the round cap breaks the console's top line — the shape cue works
  // better when the silhouette is not contained by its neighbours.
  playCap: { marginTop: -10, marginBottom: -4 },
});
