import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Eye, Star, Trash2 } from "lucide-react-native";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { COLORS } from "../../../theme";
import { useStarred } from "../../swings/useStarred";
import type { SessionSwing } from "../sessionState";

/**
 * Quick access to this session's swings (§9.6) — not the Swing Log page. Newest first;
 * the row still analyzing says so; view / delete / star sit on every row and tapping the
 * row itself views the swing, still in session mode.
 */

export interface SessionSwingListSheetProps {
  visible: boolean;
  onClose: () => void;
  swings: SessionSwing[];
  currentId: string | null;
  onView: (swingId: string) => void;
  onDelete: (swingId: string) => void;
}

export function SessionSwingListSheet({
  visible,
  onClose,
  swings,
  currentId,
  onView,
  onDelete,
}: SessionSwingListSheetProps) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="This session"
      subtitle={`${swings.length} swing${swings.length === 1 ? "" : "s"}`}
      testID="session-swing-list-sheet"
    >
      {swings.map((swing) => (
        <SwingRow
          key={swing.id}
          swing={swing}
          current={swing.id === currentId}
          onView={() => onView(swing.id)}
          onDelete={() => onDelete(swing.id)}
        />
      ))}
    </Sheet>
  );
}

function SwingRow({
  swing,
  current,
  onView,
  onDelete,
}: {
  swing: SessionSwing;
  current: boolean;
  onView: () => void;
  onDelete: () => void;
}) {
  const { starred, toggle } = useStarred(swing.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Swing ${swing.number}`}
      onPress={onView}
      style={({ pressed }) => [styles.row, current && styles.rowCurrent, pressed && styles.pressed]}
      testID={`session-swing-row-${swing.number}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{`Swing ${swing.number}`}</Text>
        {swing.status === "analyzing" ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={COLORS.aqua} />
            <Text style={styles.statusText}>analyzing…</Text>
          </View>
        ) : (
          <Text style={styles.statusText}>ready</Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View swing ${swing.number}`}
        onPress={onView}
        hitSlop={8}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Eye size={16} color={COLORS.muted} strokeWidth={2.2} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete swing ${swing.number}`}
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Trash2 size={16} color={COLORS.red} strokeWidth={2.2} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Star swing ${swing.number}`}
        accessibilityState={{ selected: starred }}
        onPress={toggle}
        hitSlop={8}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Star
          size={16}
          color={starred ? COLORS.aqua : COLORS.muted}
          strokeWidth={2.2}
          fill={starred ? COLORS.aqua : "none"}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.panel,
  },
  rowCurrent: { backgroundColor: "rgba(67,205,208,0.14)" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: COLORS.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { color: COLORS.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  action: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pressed: { opacity: 0.6 },
});
