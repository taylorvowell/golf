import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WAVE_NAV_CLEARANCE, navBarBottomInset, useNavVisibility } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { useAppNavigation } from "../../navigation";
import { themedStyles } from "../../theme";
import { useInstructor } from "./useInstructor";

/**
 * The instructor's chat bubble — a face disc floating bottom-right above the wave nav,
 * only when the golfer HAS a connected instructor (Taylor, 2026-08-19: "almost like a chat
 * bubble… It will not appear if not"). Renders nothing otherwise, so the tab shell mounts it
 * once for every normal page and the store decides.
 *
 * It rides the nav bar rather than the screen edge (Taylor, 2026-08-21): when a scroll run
 * slides the wave nav away, the bubble drops into the space the row leaves behind, on the
 * same 280ms timing — so the gap between the two never changes mid-animation and the bubble
 * is never left floating over nothing.
 *
 * Initials stand in for the face until instructor photos exist. The aqua dot is the
 * something-new signal — a dot, not a count: "there is something from your instructor" is
 * the actionable fact, the number is the chat page's business.
 */
const BUBBLE = 56;
/** The bubble's gap above whatever is below it — the nav row, or the screen's bottom pad. */
const GAP = 14;

export function InstructorBubble() {
  const instructor = useInstructor();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { hidden } = useNavVisibility();
  const styles = useStyles();

  // Matches `WaveNav`'s own slide (280ms, native driver). Travel is the row's height only:
  // the bar drops further than that, but the bubble stops where the row used to sit rather
  // than following it off the screen.
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: hidden ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [hidden, slide]);

  if (!instructor) return null;

  return (
    <Animated.View
      style={[
        styles.root,
        { bottom: navBarBottomInset(insets.bottom) + WAVE_NAV_CLEARANCE + GAP },
        {
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [0, WAVE_NAV_CLEARANCE],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        testID="instructor-bubble"
        accessibilityRole="button"
        accessibilityLabel={
          instructor.unread > 0
            ? `Your instructor ${instructor.name}, something new`
            : `Your instructor ${instructor.name}`
        }
        onPress={() => navigation.navigate("Instructor")}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={["#164B7E", "#0F2E4C"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.disc}
        >
          <Text style={styles.initials}>{instructor.initials}</Text>
        </LinearGradient>
        {instructor.unread > 0 ? <View style={styles.dot} /> : null}
      </Pressable>
    </Animated.View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { position: "absolute", right: 16, width: BUBBLE, height: BUBBLE },
  hit: { width: BUBBLE, height: BUBBLE },
  pressed: { opacity: 0.8 },
  /* The face disc — fixed navy ramp in both themes (a person's photo is its own surface,
     the same rule that keeps footage dark), round by construction. */
  disc: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 18,
    letterSpacing: 0.5,
  },
  /* The something-new dot: aqua on a bgElevated seat so it reads on the disc's navy edge —
     the seat is a drawn shape (fill), not a border. */
  dot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: t.aqua,
  },
}));
