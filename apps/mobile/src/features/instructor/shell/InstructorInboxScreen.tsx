import { Pressable, ScrollView, Text, View } from "react-native";
import { Megaphone } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppHeader,
  APP_HEADER_BAR,
  Eyebrow,
  ListSectionLabel,
  Panel,
  WAVE_NAV_CLEARANCE,
  useChromeScroll,
} from "../../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { useAppNavigation } from "../../../navigation";
import { themedStyles, useTheme } from "../../../theme";
import { ModeSwitch } from "../../mode/ModeSwitch";
import { InitialsDisc } from "../components/InitialsDisc";
import { useThreadsSeam } from "../mock/seams";

/**
 * The inbox (architecture §4a.4): one conversation per student — each a view over the D60
 * typed-entry log — plus the broadcast history rollup ("sent to 14 · 5 replies"), which is the
 * INSTRUCTOR'S only broadcast surface: students never see a broadcast as anything but a
 * personal message. Frozen and blocked threads stay listed (history is kept, §24.3) and say so.
 */
export function InstructorInboxScreen() {
  const t = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  const { conversations, broadcasts } = useThreadsSeam();

  return (
    <View style={styles.root}>
      <ScrollView
        onScroll={(e) => onChromeScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + APP_HEADER_BAR + 10,
          paddingHorizontal: 16,
          paddingBottom: WAVE_NAV_CLEARANCE + insets.bottom + 24,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Inbox</Text>

        {conversations.map((c) => (
          <Pressable
            key={c.studentId}
            testID={`conversation-${c.studentId}`}
            accessibilityRole="button"
            accessibilityLabel={`Conversation with ${c.studentName}`}
            onPress={() => navigation.navigate("InstructorThread", { studentId: c.studentId })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <InitialsDisc initials={c.initials} size={40} />
            <View style={{ flex: 1, gap: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {c.studentName}
                </Text>
                {c.state !== "active" && (
                  <Text style={styles.stateTag}>{c.state === "frozen" ? "Ended" : "Blocked"}</Text>
                )}
              </View>
              <Text
                style={[styles.preview, c.unread > 0 && styles.previewUnread]}
                numberOfLines={1}
              >
                {c.lastPreview}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.age}>{c.lastAgo}</Text>
              {c.unread > 0 && (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadCount}>{c.unread}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}

        <ListSectionLabel>Broadcasts</ListSectionLabel>
        {broadcasts.map((b) => (
          <Panel key={b.id} radius="feature" style={styles.broadcastCard}>
            <View style={styles.broadcastHead}>
              <Megaphone size={14} color={t.aqua} strokeWidth={2.4} />
              <Eyebrow>{b.audience}</Eyebrow>
              <Text style={styles.age}>{b.sentAgo}</Text>
            </View>
            <Text style={styles.broadcastText} numberOfLines={2}>
              {b.text}
            </Text>
            <Text style={styles.broadcastMeta}>
              Sent to {b.recipients} students · {b.replies}{" "}
              {b.replies === 1 ? "private reply" : "private replies"}
            </Text>
          </Panel>
        ))}
      </ScrollView>
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
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21, marginBottom: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: t.surface2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 14, flexShrink: 1 },
  stateTag: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 10.5 },
  preview: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
  previewUnread: { color: t.textSoft, fontFamily: FONT_BODY.semiBold },
  rowRight: { alignItems: "flex-end", gap: 4 },
  age: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 10.5, marginLeft: "auto" },
  unreadPill: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.aqua,
  },
  unreadCount: { color: t.heroStart, fontFamily: FONT_BODY.bold, fontSize: 10.5 },
  broadcastCard: { padding: 14, gap: 5 },
  broadcastHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  broadcastText: { color: t.text, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 18 },
  broadcastMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },
}));
