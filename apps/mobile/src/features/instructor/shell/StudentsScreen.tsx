import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { QrCode, UserPlus } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppHeader,
  APP_HEADER_BAR,
  Eyebrow,
  Input,
  ListSectionLabel,
  Panel,
  Sheet,
  WAVE_NAV_CLEARANCE,
  useChromeScroll,
} from "../../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { useAppNavigation } from "../../../navigation";
import { themedStyles } from "../../../theme";
import { ModeSwitch } from "../../mode/ModeSwitch";
import { FilterChip } from "../components/FilterChip";
import { InitialsDisc } from "../components/InitialsDisc";
import { StudentCard } from "../components/StudentCard";
import { useRosterSeam } from "../mock/seams";

/**
 * The roster (architecture §4a.2): search, §36-grade organization (groups double as broadcast
 * audiences), the pending/invited block up top, and the invite door. Sorting is by
 * needs-attention by construction — the sample arrives ordered; the real seam owns order.
 *
 * INVITE is a declared spec addition (§24.1 is golfer-initiated): the instructor extends a
 * QR/link, the golfer still ACCEPTS — control never moves. The sheet mock says exactly that.
 */
export function StudentsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  const { students, groups, pending } = useRosterSeam();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter(
      (s) =>
        (q === "" || s.name.toLowerCase().includes(q)) &&
        (group == null || s.groups.includes(group)),
    );
  }, [students, query, group]);

  return (
    <View style={styles.root}>
      <ScrollView
        onScroll={(e) => onChromeScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + APP_HEADER_BAR + 10,
          paddingHorizontal: 16,
          paddingBottom: WAVE_NAV_CLEARANCE + insets.bottom + 24,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>Students</Text>
          <Pressable
            testID="invite-student"
            accessibilityRole="button"
            accessibilityLabel="Invite a student"
            onPress={() => setInviteOpen(true)}
            style={({ pressed }) => [styles.invite, pressed && styles.invitePressed]}
          >
            <UserPlus size={16} color={styles.inviteInk.color} strokeWidth={2.4} />
            <Text style={styles.inviteLabel}>Invite</Text>
          </Pressable>
        </View>

        <Input
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="Name"
          autoCorrect={false}
        />

        <View style={styles.groups}>
          <FilterChip label="All" active={group == null} onPress={() => setGroup(null)} />
          {groups.map((g) => (
            <FilterChip key={g} label={g} active={group === g} onPress={() => setGroup(g)} />
          ))}
        </View>

        {pending.length > 0 && group == null && query === "" && (
          <>
            <ListSectionLabel>Waiting</ListSectionLabel>
            {pending.map((s) => (
              <View key={s.id} style={styles.pendingRow}>
                <InitialsDisc initials={s.initials} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingName}>{s.name}</Text>
                  <Text style={styles.pendingMeta}>
                    {s.state === "pending" ? "Asked to join your roster" : "Invite sent — not yet accepted"}
                  </Text>
                </View>
                {s.state === "pending" ? (
                  <View style={styles.pendingActions}>
                    <FilterChip label="Approve" active onPress={() => undefined} />
                    <FilterChip label="Decline" onPress={() => undefined} />
                  </View>
                ) : (
                  <Eyebrow>Invited</Eyebrow>
                )}
              </View>
            ))}
          </>
        )}

        <ListSectionLabel>{group ?? "Everyone"}</ListSectionLabel>
        {shown.length === 0 && (
          <Panel radius="feature" style={styles.emptyCard}>
            <Eyebrow>No students yet</Eyebrow>
            <Text style={styles.emptyCopy}>
              Your listing is how golfers find you — and an invite brings someone straight in.
            </Text>
          </Panel>
        )}
        {shown.map((s) => (
          <StudentCard
            key={s.id}
            student={s}
            onPress={() => navigation.navigate("StudentDetail", { studentId: s.id })}
          />
        ))}
      </ScrollView>

      <Sheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a student"
        subtitle="They scan or tap — and THEY accept. A student always controls the link."
        testID="invite-sheet"
      >
        <View style={styles.qrBox}>
          <QrCode size={120} color={styles.qrInk.color} strokeWidth={1.4} />
          <Text style={styles.qrCopy}>
            The real code and share link land when the roster is wired — this sheet is the
            placement being judged.
          </Text>
        </View>
      </Sheet>

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
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21 },
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: t.surface,
    borderRadius: 15,
    paddingHorizontal: 12,
    height: 30,
  },
  invitePressed: { backgroundColor: t.surface2 },
  inviteInk: { color: t.aqua },
  inviteLabel: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 12.5 },
  groups: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: t.surfaceBlue,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  pendingName: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 13.5 },
  pendingMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },
  pendingActions: { flexDirection: "row", gap: 6 },
  emptyCard: { padding: 18, gap: 6 },
  emptyCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 19 },
  qrBox: { alignItems: "center", gap: 12, paddingVertical: 10 },
  qrInk: { color: t.text },
  qrCopy: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
}));
