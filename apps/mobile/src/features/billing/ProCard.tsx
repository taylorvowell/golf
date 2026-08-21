import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { AQUA, COBALT, INK, NAVY, ON_DARK } from "../../theme/palette";
import { PLANS } from "./plans";

/**
 * The upgrade door — the one sell in the product, so it is the one card allowed to look like a
 * headline rather than a surface.
 *
 * **Pinned dark in both themes**, like the player and capture surfaces: a card that flips to
 * white on the light theme stops being the product's one accent and becomes another row. That is
 * why this file reads `palette` directly instead of `useTheme()` — the same sanctioned exception
 * `GlowBackdrop` and the deck take, and the reason the `INK` ramp exists as a named ramp rather
 * than a hand-mixed hex.
 *
 * Three layers, no borders and no cast shadow (both are banned app-wide — the depth here is
 * gradient and light, not an edge):
 *
 *   1. an ink gradient, near-black cooled toward the brand navy so it belongs to the hero family;
 *   2. two radial washes — aqua off the top-right, cobalt off the bottom-left — which is the glow;
 *   3. a hairline-bright top wash, so the card catches light along its upper edge the way a
 *      raised surface does, without a border drawing that edge.
 *
 * Highlights are the accent picked out inside the copy: the word that names the product and the
 * number that is the offer. Colouring the whole line would be a second headline.
 */

/** Radial size, in px. Larger than the card on purpose — only the falloff should be visible. */
const GLOW = 300;

export function ProCard({ onPress }: { onPress: () => void }) {
  const plan = PLANS.pro;

  return (
    <LinearGradient
      colors={[INK[900], INK[800], NAVY[950]]}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <Glow />

      {/* The upper-edge catch. A gradient, not a border — 7% white fading out over the top
          third reads as light landing on the card rather than a line drawn around it. */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0)"]}
        style={styles.topLight}
      />

      <View style={styles.content}>
        <Text style={styles.eyebrow}>
          SwingSage <Text style={styles.eyebrowAccent}>Pro</Text>
        </Text>

        <Text style={styles.title}>{plan.pitch}</Text>

        <Text style={styles.copy}>
          <Text style={styles.copyAccent}>{plan.analysesPerMonth} analyses</Text> a month, overlays,
          pro comparison and two-phone capture.
        </Text>

        <Pressable
          testID="profile-upgrade"
          accessibilityRole="button"
          accessibilityLabel="Upgrade to SwingSage Pro"
          onPress={onPress}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaLabel}>Upgrade to Pro</Text>
          <ChevronRight size={15} color={INK[900]} strokeWidth={2.8} />
        </Pressable>
      </View>
    </LinearGradient>
  );
}

/**
 * The glow. Two off-canvas radials whose falloff crosses the card — the light source sits
 * outside the frame, which is what keeps it reading as a glow rather than as two circles.
 * Stronger than `GlowBackdrop`'s wash because this is a headline, not a waiting room.
 */
function Glow() {
  return (
    <View pointerEvents="none" style={styles.glowLayer}>
      <Svg width={GLOW} height={GLOW} style={styles.glowTopRight}>
        <Defs>
          <RadialGradient id="pro-glow-aqua" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={AQUA[500]} stopOpacity={0.3} />
            <Stop offset="0.62" stopColor={AQUA[500]} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#pro-glow-aqua)" />
      </Svg>
      <Svg width={GLOW} height={GLOW} style={styles.glowBottomLeft}>
        <Defs>
          <RadialGradient id="pro-glow-cobalt" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={COBALT[500]} stopOpacity={0.38} />
            <Stop offset="0.68" stopColor={COBALT[500]} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#pro-glow-cobalt)" />
      </Svg>
    </View>
  );
}

/**
 * Fixed rather than themed — see the note above. `StyleSheet.create` instead of `themedStyles`
 * for the same reason: there is nothing here for a theme to change.
 */
const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    borderRadius: 18,
    overflow: "hidden",
  },
  glowLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" },
  glowTopRight: { position: "absolute", right: -GLOW * 0.42, top: -GLOW * 0.48 },
  glowBottomLeft: { position: "absolute", left: -GLOW * 0.46, bottom: -GLOW * 0.5 },
  topLight: { position: "absolute", left: 0, right: 0, top: 0, height: 56 },

  content: { padding: 18, gap: 7 },
  eyebrow: {
    color: ON_DARK,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    opacity: 0.72,
  },
  /** The product's name carries the accent; the wordmark around it stays quiet. */
  eyebrowAccent: { color: AQUA[400], opacity: 1 },
  title: {
    color: ON_DARK,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 19,
    lineHeight: displayLine(19),
    letterSpacing: -0.2,
  },
  copy: {
    color: ON_DARK,
    fontFamily: FONT_BODY.regular,
    fontSize: 12.5,
    lineHeight: 19,
    opacity: 0.78,
  },
  /** The offer's number — the one figure a golfer is deciding on. */
  copyAccent: { color: AQUA[400], fontFamily: FONT_BODY.bold, opacity: 1 },

  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 42,
    borderRadius: 13,
    marginTop: 8,
    backgroundColor: ON_DARK,
  },
  ctaPressed: { opacity: 0.82 },
  ctaLabel: {
    color: INK[900],
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
