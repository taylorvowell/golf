import { Pressable, Text, View } from "react-native";

import { SCROLL_PRESS_DELAY_MS } from "../../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { themedStyles } from "../../../theme";

export interface MilestoneSpotlightProps {
  /** The figure being celebrated — "50", "1 yr". Big type, so two or three characters. */
  emblem: string;
  title: string;
  line: string;
  /** Optional deep link; a milestone with nowhere to go is still worth its moment. */
  onPress?: () => void;
  testID?: string;
}

/**
 * The celebratory template — milestones and anniversaries. The hero's dark ground rather
 * than the feature cards' aqua tint, because these are a moment, not a pitch: the emblem is
 * the card. Whole card is the (optional) tap target; no button, because "50 swings" is not
 * asking the golfer to do anything.
 */
export function MilestoneSpotlight({ emblem, title, line, onPress, testID }: MilestoneSpotlightProps) {
  const styles = useStyles();
  const body = (pressed: boolean) => (
    <View style={[styles.card, pressed && styles.pressed]} testID={testID}>
      <Text style={styles.emblem} numberOfLines={1}>
        {emblem}
      </Text>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.line} numberOfLines={2}>
          {line}
        </Text>
      </View>
    </View>
  );

  if (!onPress) return body(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      style={{ flex: 1 }}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderRadius: 14,
    backgroundColor: t.heroMid,
  },
  /* Over the hero ground there is no surface ramp to step — the footage-adjacent carve-out. */
  pressed: { opacity: 0.85 },
  emblem: {
    color: t.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 44,
    letterSpacing: -1,
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    lineHeight: displayLine(17),
    /* Room for the carousel frame's X. */
    paddingRight: 24,
  },
  line: {
    marginTop: 5,
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    lineHeight: 16,
  },
}));
