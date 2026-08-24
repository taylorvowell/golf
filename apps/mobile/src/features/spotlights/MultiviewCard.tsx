import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

import { Button, DualViewIcon, SCROLL_PRESS_DELAY_MS } from "../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { AQUA, INK, NAVY, ON_DARK } from "../../theme/palette";

export interface MultiviewCardProps {
  onPress: () => void;
  testID?: string;
}

/**
 * The headline spotlight — two phones, one swing. Bespoke rather than templated because it
 * is the deck's flagship and earns its own composition: the ProCard's pinned-dark ink
 * family (the sanctioned palette exception — a headline card must not flip white on the
 * light theme), with the dual-view mark standing in as art.
 *
 * TODO(asset): the art region is a PLACEHOLDER. The real card carries a photo of an actual
 * two-phone setup beside an app screenshot of multiview — a HANDOFF row for Taylor when
 * this track's step 04 runs. The composition already reserves the space, so the asset swap
 * is an <Image> in `art`, not a redesign.
 */
export function MultiviewCard({ onPress, testID }: MultiviewCardProps) {
  return (
    <LinearGradient
      testID={testID}
      colors={[INK[900], INK[800], NAVY[950]]}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.art}>
        <DualViewIcon size={64} color={AQUA[400]} strokeWidth={1.4} />
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          Multiview
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          See your swing from both sides
        </Text>
        <Text style={styles.copy} numberOfLines={2}>
          Two phones, one swing — down the line and face-on, in sync.
        </Text>
        <Button
          label="Set it up"
          variant="performance"
          onPress={onPress}
          pressDelayMs={SCROLL_PRESS_DELAY_MS}
          style={styles.cta}
        />
      </View>
    </LinearGradient>
  );
}

/** Fixed-dark, like ProCard — `StyleSheet.create` because there is nothing for a theme to change. */
const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
    overflow: "hidden",
  },
  /* The placeholder art bed — the real photo/screenshot pair lands here. */
  art: {
    width: 84,
    alignSelf: "stretch",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  body: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: AQUA[400],
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1.12,
    textTransform: "uppercase",
    /* Room for the carousel frame's X. */
    paddingRight: 30,
  },
  title: {
    marginTop: 4,
    color: ON_DARK,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    lineHeight: displayLine(16),
    letterSpacing: -0.2,
  },
  copy: {
    marginTop: 4,
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_BODY.regular,
    fontSize: 10.5,
    lineHeight: 15,
  },
  cta: { marginTop: 10, alignSelf: "flex-start" },
});
