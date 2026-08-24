import { StyleSheet, Text, View } from "react-native";

import { Button, DualViewIcon, SCROLL_PRESS_DELAY_MS } from "../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { AQUA, ON_DARK } from "../../theme/palette";
import { SpotlightBed } from "./templates/SpotlightBed";

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
    <SpotlightBed testID={testID} style={styles.card}>
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
      {/* The art panel: full-height, its own quiet ground with an aqua wash behind the mark.
          The DualView mark is ~2.1× its `size` wide (two frames + the exchange arrow), so 44
          is what actually FITS a ~104pt panel — 64 was breaking the box. */}
      <View style={styles.art}>
        <View style={styles.artGlow} />
        <DualViewIcon size={44} color={AQUA[400]} strokeWidth={1.2} />
      </View>
    </SpotlightBed>
  );
}

/** Fixed-dark, like ProCard — `StyleSheet.create` because there is nothing for a theme to change. */
const styles = StyleSheet.create({
  /* Layout only — the ground is SpotlightBed, one dark material for the whole deck. */
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
    padding: 16,
  },
  /* The placeholder art panel — the real photo/screenshot pair lands here as an <Image>. */
  art: {
    width: 104,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  /* The wash the mark sits in — a soft aqua pool, not a spotlight. */
  artGlow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(45,240,251,0.10)",
  },
  body: { flex: 1, minWidth: 0, justifyContent: "center" },
  eyebrow: {
    color: AQUA[400],
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1.12,
    textTransform: "uppercase",
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
