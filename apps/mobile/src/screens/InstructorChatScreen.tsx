import { ScrollView, Text, View } from "react-native";
import { MessageCircle } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Panel, TitleText } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
import { useInstructor } from "../features/instructor/useInstructor";
import { themedStyles, useTheme } from "../theme";

/**
 * Instructor chat — a PLACEHOLDER (coach-surface step 02). The real conversation surface is
 * the coach-collaboration track's substrate (typed immutable entries: messages, lessons,
 * drills, plan updates); this page only holds the door open in the meantime.
 */
export function InstructorChatScreen() {
  const instructor = useInstructor();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <Panel radius="feature" style={styles.card}>
        <View style={styles.heroIcon}>
          <MessageCircle size={24} color={t.aqua} strokeWidth={2} />
        </View>
        <TitleText>
          {instructor ? `Messages with ${instructor.name}` : "Instructor messages"}
        </TitleText>
        <Text style={styles.copy}>
          Two-way messaging with your instructor opens with the instructor platform — texts,
          swing reviews, video lessons and assigned drills, all in one thread.
        </Text>
      </Panel>
    </ScrollView>
  );
}

/** Aqua at 14% — the coach/instructor accent bed. */
const AQUA_BED = "rgba(45,240,251,0.14)";

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16 },
  card: { padding: 18, gap: 8 },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AQUA_BED,
    marginBottom: 4,
  },
  copy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
}));
