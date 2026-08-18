import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../../theme";
import { arcPath, polar } from "./arc";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * `.swing-profile` (mockup §06, "hybrid orbital board"): the conic orbit ring (cobalt 0–24%,
 * aqua 24–58%, green 58–84%, surface3 remainder — SVG arcs here), a navy-gradient core with
 * the overall score, four coloured nodes riding the ring, and up to three floating callout
 * cards. Standard: orbit 166 / core 98 / height 246. `compact`: 102 / 60 / 118.
 * Node ring-cutouts use a surface-coloured border — shape-drawing, allowed.
 */
export interface ProfileCallout {
  value: string;
  caption?: string;
  tone: "good" | "bad" | "primary";
  /** Which corner it floats in — c1 top-left, c2 right, c3 bottom-left (mockup classes). */
  slot: "c1" | "c2" | "c3";
}

const SEGMENTS: Array<{ end: number; key: "cobalt" | "aqua" | "good" }> = [
  { end: 0.24, key: "cobalt" },
  { end: 0.58, key: "aqua" },
  { end: 0.84, key: "good" },
];

/** Node angular positions eyeballed from the mockup's px offsets (l15/t45 → upper-left, …). */
const NODE_ANGLES = [308, 55, 138, 215];

export function SwingProfile({
  score,
  label = "Swing score",
  callouts = [],
  compact,
  style,
  accessibilityLabel,
}: {
  score: number;
  label?: string;
  callouts?: ProfileCallout[];
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const orbit = compact ? 102 : 166;
  const core = compact ? 60 : 98;
  const height = compact ? 118 : 246;
  const stroke = compact ? 12 : 18;
  const r = orbit / 2 - stroke / 2;
  const c = orbit / 2;
  const orbitTop = compact ? 8 : 40;
  const nodeSize = compact ? 8 : 12;
  const nodeRing = compact ? 3 : 4;
  const nodeColors = [t.aqua, t.cobalt, t.good, t.bad];

  const calloutTone = { good: t.good, bad: t.bad, primary: t.cobalt } as const;
  const calloutPos: Record<ProfileCallout["slot"], ViewStyle> = compact
    ? {
        c1: { left: 0, top: 2 },
        c2: { right: 0, top: 52 },
        c3: { left: 2, bottom: 0 },
      }
    : {
        c1: { left: 0, top: 17 },
        c2: { right: 0, top: 105 },
        c3: { left: 8, bottom: 5 },
      };

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? `${label} ${score}`}
      style={[{ height, overflow: compact ? "visible" : "hidden" }, style]}
    >
      {/* The orbit ring, centred horizontally (compact sits at 42% like the mockup). */}
      <View
        style={{
          position: "absolute",
          left: compact ? "42%" : "50%",
          top: orbitTop,
          width: orbit,
          height: orbit,
          marginLeft: -orbit / 2,
        }}
      >
        <Svg width={orbit} height={orbit}>
          <Path
            d={arcPath(c, c, r, 0, 360)}
            stroke={t.surface3}
            strokeWidth={stroke}
            fill="none"
          />
          {SEGMENTS.map((seg, i) => {
            const start = i === 0 ? 0 : SEGMENTS[i - 1].end * 360;
            const color = seg.key === "good" ? t.good : t[seg.key];
            return (
              <Path
                key={seg.key}
                d={arcPath(c, c, r, start, seg.end * 360)}
                stroke={color}
                strokeWidth={stroke}
                fill="none"
              />
            );
          })}
        </Svg>
        {/* The four nodes riding the ring. */}
        {NODE_ANGLES.map((angle, i) => {
          const p = polar(c, c, r, angle);
          return (
            <View
              key={angle}
              style={{
                position: "absolute",
                left: p.x - nodeSize / 2 - nodeRing,
                top: p.y - nodeSize / 2 - nodeRing,
                width: nodeSize + nodeRing * 2,
                height: nodeSize + nodeRing * 2,
                borderRadius: 999,
                backgroundColor: nodeColors[i],
                // The mockup's 0-0-0-4px surface halo — a shape-drawing ring, not an outline.
                borderWidth: nodeRing,
                borderColor: t.surface,
              }}
            />
          );
        })}
        {/* The core — navy hero gradient disc with the score. */}
        <LinearGradient
          colors={[t.heroStart, t.heroMid, t.heroEnd]}
          locations={[0, 0.62, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            left: (orbit - core) / 2,
            top: (orbit - core) / 2,
            width: core,
            height: core,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: t.onDark,
              fontFamily: FONT_DISPLAY.black,
              fontSize: compact ? 23 : 39,
              lineHeight: compact ? 20 : 33,
              letterSpacing: -0.03 * (compact ? 23 : 39),
            }}
          >
            {score}
          </Text>
          {!compact && (
            <Text
              style={{
                marginTop: 7,
                color: "rgba(180,235,238,1)",
                fontFamily: FONT_DISPLAY.black,
                fontSize: 7,
                letterSpacing: 0.84,
                textTransform: "uppercase",
              }}
            >
              {label}
            </Text>
          )}
        </LinearGradient>
      </View>
      {/* Floating callouts. */}
      {callouts.map((call) => (
        <View
          key={call.slot}
          style={{
            position: "absolute",
            minWidth: compact ? 54 : 86,
            padding: compact ? 5 : 8,
            borderRadius: compact ? 4 : 6,
            backgroundColor: t.surface,
            ...calloutPos[call.slot],
          }}
        >
          <Text
            style={{
              color: calloutTone[call.tone],
              fontFamily: FONT_DISPLAY.black,
              fontSize: compact ? 6 : 9,
              lineHeight: compact ? 7 : 10,
            }}
          >
            {call.value}
          </Text>
          {call.caption != null && !compact && (
            <Text
              style={{
                marginTop: 4,
                color: t.muted,
                fontFamily: FONT_BODY.bold,
                fontSize: 6,
                lineHeight: 7,
              }}
            >
              {call.caption}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
