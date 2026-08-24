import { type ReactNode } from "react";
import { Text, View } from "react-native";

import { Button, SCROLL_PRESS_DELAY_MS } from "../../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { themedStyles } from "../../../theme";
import { SpotlightBed } from "./SpotlightBed";

export interface FeatureSpotlightProps {
  /** A lucide glyph, rendered inside the aqua tile. Size ~22, color the theme's onDark. */
  icon: ReactNode;
  eyebrow: string;
  title: string;
  copy: string;
  cta?: { label: string; onPress: () => void };
  testID?: string;
}

/**
 * The standard feature-showcase card — the visual language of the old home intro cards
 * (aqua-tint bed, icon tile, eyebrow/title/copy, one Start-shaped button), re-homed as a
 * spotlight template so every "try this" card is the same object. Fills the slot the
 * carousel gives it; the dismiss X is the carousel frame's, not this card's.
 */
export function FeatureSpotlight({ icon, eyebrow, title, copy, cta, testID }: FeatureSpotlightProps) {
  const styles = useStyles();
  return (
    <SpotlightBed testID={testID} style={styles.card}>
      <View style={styles.icon}>{icon}</View>
      <View style={styles.body}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          {eyebrow}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.copy} numberOfLines={3}>
          {copy}
        </Text>
        {cta ? (
          <Button
            label={cta.label}
            onPress={cta.onPress}
            pressDelayMs={SCROLL_PRESS_DELAY_MS}
            style={styles.cta}
          />
        ) : null}
      </View>
    </SpotlightBed>
  );
}

const useStyles = themedStyles((t) => ({
  /* Layout only — the ground is SpotlightBed, one dark material for the whole deck. */
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 15,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.aqua,
  },
  body: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: t.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1.12,
    textTransform: "uppercase",
    /* Room for the carousel frame's X — the eyebrow is the line it overlaps. */
    paddingRight: 30,
  },
  title: {
    marginTop: 4,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
    lineHeight: displayLine(15),
  },
  copy: {
    marginTop: 4,
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 15,
  },
  cta: { marginTop: "auto", alignSelf: "flex-start" },
}));
