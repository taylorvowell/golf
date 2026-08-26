import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Dumbbell, Plus, Video } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Eyebrow, FloatingBack, Input, Panel, Sheet } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";
import { useDrillsSeam } from "../features/instructor/mock/seams";

/**
 * The instructor's drill library (architecture §4a.5, §18.5/D60): their authored drills —
 * browsable, searchable, created by recording or uploading a demo with a name and cues —
 * always PLAIN class (an instructor authors content, never geometry), visible only to them
 * and the students they assign to. The templates door is the reusable-program seam
 * (assign a sequence to many students at once) — a later fill, rendered now.
 *
 * Mocked: `useDrillsSeam`; the create flow collects nothing and says so.
 */
export function DrillLibraryScreen() {
  const t = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const drills = useDrillsSeam();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drills.filter((d) => q === "" || d.name.toLowerCase().includes(q));
  }, [drills, query]);

  return (
    <View style={styles.root}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 54,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>Drill library</Text>
          <Pressable
            testID="drill-create"
            accessibilityRole="button"
            accessibilityLabel="Create a drill"
            onPress={() => setCreateOpen(true)}
            style={({ pressed }) => [styles.create, pressed && styles.createPressed]}
          >
            <Plus size={18} color={t.onDark} strokeWidth={2.6} />
          </Pressable>
        </View>

        <Input label="Search" value={query} onChangeText={setQuery} placeholder="Drill name" />

        {shown.map((d) => (
          <View key={d.id} style={styles.drillCard}>
            <View style={styles.drillGlyph}>
              {d.hasDemo ? (
                <Video size={17} color={t.aqua} strokeWidth={2.2} />
              ) : (
                <Dumbbell size={17} color={t.aqua} strokeWidth={2.2} />
              )}
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.drillName}>{d.name}</Text>
              <Text style={styles.drillMeta} numberOfLines={1}>
                {d.cues}
                {d.equipment ? ` · ${d.equipment}` : ""}
              </Text>
              <Text style={styles.drillAssigned}>
                {d.assignedTo === 0
                  ? "Not assigned"
                  : `Assigned to ${d.assignedTo} ${d.assignedTo === 1 ? "student" : "students"}`}
                {d.hasDemo ? " · demo video" : " · no demo yet"}
              </Text>
            </View>
          </View>
        ))}

        <Panel radius="feature" style={styles.templates}>
          <Eyebrow>Programs</Eyebrow>
          <Text style={styles.templatesCopy}>
            Reusable sequences — assign a whole program to a group at once. Lands after the drill
            system is wired.
          </Text>
        </Panel>
      </ScrollView>

      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a drill"
        subtitle="Record or upload a demo, name it, add your cues"
        testID="drill-create-sheet"
      >
        <View style={{ gap: 10, paddingBottom: 6 }}>
          <Button label="Record a demo" variant="primary" onPress={() => setCreateOpen(false)} />
          <Button label="Upload a video" variant="ghost" onPress={() => setCreateOpen(false)} />
          <Text style={styles.createNote}>
            Mocked — authoring lands with the drill library's instructor dimension (D60): your
            drills stay yours and your students', never the public catalog.
          </Text>
        </View>
      </Sheet>

      <FloatingBack onPress={() => navigation.goBack()} />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21 },
  create: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  createPressed: { backgroundColor: t.cobaltPressed },
  drillCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  drillGlyph: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surfaceBlue,
  },
  drillName: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 14 },
  drillMeta: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12 },
  drillAssigned: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 10.5 },
  templates: { padding: 16, gap: 6 },
  templatesCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
  createNote: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 17 },
}));
