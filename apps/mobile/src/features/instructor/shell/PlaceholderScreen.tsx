import { useRef } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader, APP_HEADER_BAR } from "../../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { ModeSwitch } from "../../mode/ModeSwitch";
import { useAppNavigation } from "../../../navigation";
import { themedStyles } from "../../../theme";

/**
 * The instructor shell's stand-in page (step 03) — chrome real, content named-and-empty.
 * Step 04 replaces the body of each tab with the mocked surface; the header, the mode
 * dropdown and the bar underneath are already the real thing. Deliberately one shared
 * component: three copies of an empty state would be three files to delete next step.
 */
export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  // Placeholders don't scroll, so the header has nothing to slide from — a static zero.
  const chromePx = useRef(new Animated.Value(0)).current;

  return (
    <View style={styles.root}>
      <View style={[styles.body, { paddingTop: insets.top + APP_HEADER_BAR + 24 }]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>{note}</Text>
      </View>
      <AppHeader
        chromePx={chromePx}
        onProfile={() => navigation.navigate("Profile")}
        modeSwitch={<ModeSwitch />}
      />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  body: { flex: 1, paddingHorizontal: 24, gap: 8 },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 22 },
  note: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13.5, lineHeight: 20 },
}));
