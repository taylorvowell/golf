import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Trash2 } from "lucide-react-native";

import { PendingDots } from "./PendingDots";
import { Shimmer } from "./Shimmer";
import { ANALYSIS_STAGES } from "../../features/session/processing";

import { SCROLL_PRESS_DELAY_MS } from "./press";
import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";
import { ScoreOrb } from "./ScoreOrb";

/**
 * `.swing-list` / `.swing-row-demo` (mockup §08): the connected-marker swing list — a
 * timeline rail through 14px gradient dots (aqua→cobalt, surface2 halo), title + toned
 * subtitle, ring score at the right.
 *
 * Each swing is its OWN surface2 card with whitespace between (Taylor 2026-08-19) — one
 * grey bed over the whole list made the swings read as a single block. The rail sits to the
 * LEFT of the cards, in the parent's surface, so the timeline is separated from the swings
 * while its dots stay centred on each card. It still connects across the whitespace: every
 * non-first row's segment extends `gap` px above its own row to bridge the gap, so the line
 * runs unbroken while the cards separate.
 *
 * The rail column lives OUTSIDE the Pressable and stretches to the row: padding inside the
 * card can never shorten a segment and cut visible gaps into the line between dots (which is
 * exactly how an earlier layout shipped broken).
 */
export interface SwingTimelineItem {
  key: string;
  title: string;
  subtitle?: string;
  subtitleTone?: "positive" | "negative" | "neutral";
  /** Extra content beside the title, e.g. a compact `Tag`. */
  titleAccessory?: ReactNode;
  /** A small picture at the row's left edge, inside the card — the swing's own contact frame. */
  leading?: ReactNode;
  /** Sits before the subtitle on the same line — the angle pill. */
  subtitlePrefix?: ReactNode;
  score?: number;
  onPress?: () => void;
  /** Adds a trash button at the row's right edge. Omit and the row has no destructive action —
   *  this is opt-in per surface, because a delete is not something every list should offer. */
  onDelete?: () => void;
  /**
   * A swing that is still arriving — an import mid-pipeline.
   *
   * It draws the same row with the waiting dots where the score would be, and it ARRIVES:
   * fading and rising into place rather than appearing between two frames, because the whole
   * point of the row is to show something happening. Nothing about it is tappable and it carries
   * no delete — there is no swing to open yet, and deleting a half-uploaded one is a state the
   * pipeline has no answer for.
   */
  pending?: boolean;
  /**
   * An arriving swing that did NOT arrive.
   *
   * Same row, same place in the timeline — a failure is not a swing that vanished, it is a swing
   * that stopped, and moving it or hiding it makes the golfer wonder whether their video is gone.
   * It paints red instead of cobalt, carries the reason as its subtitle, and shows no progress
   * track: there is nothing still in progress. Like `pending` it is never tappable, because there
   * is still no swing to open.
   */
  failed?: boolean;
  /**
   * A pending row's staged progress — the same five segments the after-swing screen's analyzing
   * bar lights, in the log's own theme. Stages, never a percentage: the segment shown is the
   * segment the JOB reports, and a bar that creeps toward 90% on a queue nobody is draining is
   * a lie a golfer believes exactly once.
   */
  progress?: { stage: string; stageIndex: number };
  /** On its way out — the row fades, slides and collapses before it unmounts. */
  removing?: boolean;
  testID?: string;
}

export function SwingTimelineList({
  items,
  compact,
  style,
}: {
  items: SwingTimelineItem[];
  /** `.swing-stack-mini`'s tighter rows inside the latest card. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const tone = { positive: t.good, negative: t.bad, neutral: t.textSoft } as const;
  const minHeight = compact ? 68 : 84;
  const railWidth = compact ? 22 : 26;
  const gap = compact ? 6 : 8;
  return (
    <View style={[{ gap }, style]}>
      {items.map((item, i) => (
        <RowMotion
          key={item.key}
          arrive={item.pending === true && item.failed !== true}
          removing={item.removing === true}
          // The red veil covers the CARD, not the timeline rail beside it — the rail belongs to
          // the list, and tinting it would say the whole session was going.
          veilInset={railWidth}
          veilColor={t.bad}
        >
          {/* The rail + dot, beside the card. First/last rows half-rail, exactly as the mockup
              clips them; every other row's segment starts -gap above the row to bridge the
              whitespace. */}
          <View style={{ width: railWidth }}>
            <View
              style={{
                position: "absolute",
                left: 10,
                top: i === 0 ? "50%" : -gap,
                bottom: i === items.length - 1 ? "50%" : 0,
                width: 2,
                backgroundColor: t.surface3,
              }}
            />
            <LinearGradient
              colors={[t.aqua, t.cobalt]}
              style={{
                position: "absolute",
                left: 4,
                top: "50%",
                marginTop: -7,
                width: 14,
                height: 14,
                borderRadius: 7,
                // The mockup's 4px halo — shape-drawing ring. It matches the SESSION card's
                // surface now that the rail rides beside the swing cards, not inside them.
                borderWidth: 2,
                borderColor: t.surface,
              }}
            />
          </View>
          <Pressable
            testID={item.testID}
            accessibilityRole={item.onPress ? "button" : undefined}
            accessibilityLabel={`${item.title}${item.score != null ? `, score ${item.score}` : ""}`}
            onPress={item.onPress}
            disabled={!item.onPress}
            unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 10 : 12,
              minHeight,
              paddingHorizontal: compact ? 12 : 14,
              borderRadius: 10,
              // Pressed is a fill step plus a slight compression (Button's press idiom) — the
              // ramp step alone is a ~4% shade shift and reads as nothing on a bright screen.
              // A swing that is still arriving is a soft AQUA bed under a sweeping shimmer
              // (Taylor, 2026-08-23) — it used to be a solid cobalt slab with white ink, which
              // shouted louder than any finished swing and said "different" rather than
              // "working". Aqua is the app's activity accent and the motion is the actual
              // claim; the ink stays the list's own, so the row already reads as the swing it
              // is about to become. Still not a surface-ramp step, so it cannot be mistaken
              // for a finished one.
              backgroundColor: item.failed
                ? t.bad
                : item.pending
                  ? t.aquaSoft
                  : pressed
                    ? t.surface3
                    : t.surface2,
              overflow: item.pending ? "hidden" : undefined,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
          {/* Behind the row's content, clipped to the card. */}
          {item.pending ? <Shimmer radius={10} /> : null}
          {item.leading}
          <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                style={{
                  color: item.failed ? t.onDark : t.text,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: compact ? 15 : 16,
                }}
              >
                {item.title}
              </Text>
              {item.titleAccessory}
            </View>
            {(item.subtitle != null || item.subtitlePrefix) && (
              <View
                style={{
                  marginTop: 4,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {item.subtitlePrefix}
                {item.subtitle != null && (
                  <Text
                    numberOfLines={item.failed ? 3 : 1}
                    style={{
                      flexShrink: 1,
                      minWidth: 0,
                      color: item.failed ? t.onDark : tone[item.subtitleTone ?? "neutral"],
                      fontFamily: FONT_BODY.regular,
                      fontSize: 12,
                    }}
                  >
                    {item.subtitle}
                  </Text>
                )}
              </View>
            )}
            {item.progress ? (
              <View style={{ marginTop: 6, gap: 5 }}>
                <Text
                  style={{
                    color: t.textSoft,
                    fontFamily: FONT_BODY.bold,
                    fontSize: 11,
                  }}
                  numberOfLines={1}
                >
                  {item.progress.stage}
                </Text>
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {ANALYSIS_STAGES.map((name, index) => (
                    <View
                      key={name}
                      style={{
                        flex: 1,
                        height: 3,
                        borderRadius: 99,
                        // Lit segments are cobalt on the aqua bed: aqua on aqua has nothing
                        // to say, and the unlit track is the ramp's own step in both states.
                        backgroundColor:
                          index <=
                          Math.max(0, Math.min(ANALYSIS_STAGES.length - 1, item.progress!.stageIndex))
                            ? item.pending
                              ? t.cobalt
                              : t.aqua
                            : t.surface3,
                      }}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
          {/* Muted on purpose: the session's average circle is the prominent number; the
              per-swing scores recede beneath it (Taylor 2026-08-17). */}
          {item.failed ? null : item.pending ? (
            <View style={{ width: compact ? 44 : 48, alignItems: "center" }}>
              <PendingDots color={t.cobalt} size={6} />
            </View>
          ) : (
            item.score != null && <ScoreOrb muted score={item.score} size={compact ? 44 : 48} />
          )}
          {/* NESTED on purpose, and it works: a child pressable becomes the responder on
              touch-down, so tapping the bin never opens the swing. Outside the card it would be
              a floating icon in the list's gutter, unattached to the row it destroys. */}
          {item.onDelete ? (
            <Pressable
              testID={item.testID ? `${item.testID}-delete` : undefined}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.title}`}
              hitSlop={10}
              onPress={item.onDelete}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? t.surface3 : "transparent",
              })}
            >
              <Trash2
                size={16}
                color={item.failed ? t.onDark : t.muted2}
                strokeWidth={2.2}
              />
            </Pressable>
          ) : null}
          </Pressable>
        </RowMotion>
      ))}
    </View>
  );
}

/**
 * The row's entrance and its exit.
 *
 * `arrive` off and `removing` off is a plain row — a settled list must not replay itself every
 * time the screen re-renders, and only a row with something to announce animates at all.
 *
 * **The exit is a sentence, not a fade** (Taylor, 2026-08-22): the row goes RED first, then slides
 * off to the right and out. The tint is what says *deleted* rather than *finished loading* — the
 * arriving row also leaves this list, and if the two left the same way the golfer would have no
 * way to tell a deletion from an arrival landing. It is fast on purpose; a destructive animation
 * the golfer has to wait through is a confirmation dialog wearing a second costume.
 *
 * **Three values, two drivers, two views, and that separation is required.** Opacity, translate
 * and the veil are native-driven; height is a layout property the native driver cannot touch, and
 * pairing them in one style object makes React Native reject the layout half outright so nothing
 * animates at all (`.claude/rules/react-native.md`). The height is only ever set while collapsing
 * — a row at rest keeps its natural height, so a content change never has to be re-measured.
 */
function RowMotion({
  arrive,
  removing,
  veilInset = 0,
  veilColor,
  children,
}: {
  arrive: boolean;
  removing: boolean;
  /** Left offset of the veil — the timeline rail's width, so only the card is tinted. */
  veilInset?: number;
  veilColor?: string;
  children: ReactNode;
}) {
  /** Native. 1 = present, and the arrival's rise reads off it. */
  const enter = useRef(new Animated.Value(arrive ? 0 : 1)).current;
  /** Native. 0 → 1 as the row leaves to the right. */
  const exit = useRef(new Animated.Value(0)).current;
  /** Native. The red veil's own opacity, so the tint lands BEFORE the slide starts. */
  const veil = useRef(new Animated.Value(0)).current;
  /** Non-native, in pixels. Only read once `collapsing` is true. */
  const box = useRef(new Animated.Value(0)).current;
  const [collapsing, setCollapsing] = useState(false);
  const measured = useRef(0);

  useEffect(() => {
    if (!arrive) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [arrive, enter]);

  useEffect(() => {
    if (!removing) return;
    // From its own measured height, so the collapse starts where the row actually is.
    box.setValue(measured.current);
    Animated.sequence([
      Animated.timing(veil, {
        toValue: 1,
        duration: VEIL_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(exit, {
          toValue: 1,
          duration: SLIDE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(box, {
          toValue: 0,
          duration: SLIDE_MS + 40,
          delay: 60,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
    ]).start();
    // The clip is turned on with the SLIDE, not with the tint: a row clipped from the first frame
    // cannot slide past its own right edge, and the exit would read as a fade in place.
    const clip = setTimeout(() => setCollapsing(true), VEIL_MS);
    return () => clearTimeout(clip);
  }, [box, exit, removing, veil]);

  return (
    <Animated.View
      style={collapsing ? { height: box, overflow: "hidden" } : undefined}
      onLayout={(e) => {
        // Never while collapsing — the box is being animated and would overwrite its own target.
        if (!collapsing) measured.current = Math.round(e.nativeEvent.layout.height);
      }}
    >
      <Animated.View
        style={{
          flexDirection: "row",
          alignItems: "stretch",
          opacity: Animated.multiply(
            enter,
            exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          ),
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            {
              translateX: exit.interpolate({
                inputRange: [0, 1],
                outputRange: [0, SLIDE_OUT_PX],
              }),
            },
          ],
        }}
      >
        {children}
        {removing && veilColor ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: veilInset,
              right: 0,
              top: 0,
              bottom: 0,
              borderRadius: 10,
              backgroundColor: veilColor,
              // Translucent, not solid: the golfer has to still see WHICH swing is going.
              opacity: veil.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] }),
            }}
          />
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

/** How long the row spends turning red before it starts to leave. */
const VEIL_MS = 130;
/** The slide itself. Quick — this is an acknowledgement, not a scene. */
const SLIDE_MS = 190;
/** Far enough to be off any phone's card, without measuring the screen for one animation. */
const SLIDE_OUT_PX = 480;
