import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Eye, Star, Trash2 } from "lucide-react-native";
import type { ImageSource } from "expo-image";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { useTheme } from "../../../theme";
import { useStarred } from "../../swings/useStarred";
import type { SessionSwing } from "../sessionState";
import { SwingLoader } from "../../../design/system/SwingLoader";

/**
 * The swings recorded on THIS visit (§9.6) — the `Swings` door on the after-swing bar. It is
 * deliberately not the Swing Log page, which is where `Done` goes; it is a short list of what
 * the golfer has hit since opening the camera, dressed in the log's language (Taylor, step-03
 * iteration): the swing-timeline treatment — a surface2 group with the connected rail through
 * gradient dots — plus a per-swing thumbnail, with view / delete / star on every row. Tapping
 * the row views the swing without leaving the capture surface.
 *
 * The rail + dot construction mirrors `SwingTimelineList` (design/system); the rows differ
 * (thumbnail + actions), which is why this composes the pattern rather than forcing new
 * props onto the system component.
 */

export interface SessionSwingListSheetProps {
  visible: boolean;
  onClose: () => void;
  swings: SessionSwing[];
  currentId: string | null;
  /** The clip's poster frame — one shared stub source until per-swing media exists. */
  thumb: ImageSource | null;
  onView: (swingId: string) => void;
  onDelete: (swingId: string) => void;
}

export function SessionSwingListSheet({
  visible,
  onClose,
  swings,
  currentId,
  thumb,
  onView,
  onDelete,
}: SessionSwingListSheetProps) {
  const t = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="This session"
      subtitle={`${swings.length} swing${swings.length === 1 ? "" : "s"}`}
      testID="session-swing-list-sheet"
    >
      <View style={[styles.group, { backgroundColor: t.surface2 }]}>
        {swings.map((swing, i) => (
          <SwingRow
            key={swing.id}
            swing={swing}
            first={i === 0}
            last={i === swings.length - 1}
            current={swing.id === currentId}
            thumb={thumb}
            onView={() => onView(swing.id)}
            onDelete={() => onDelete(swing.id)}
          />
        ))}
      </View>
    </Sheet>
  );
}

function SwingRow({
  swing,
  first,
  last,
  current,
  thumb,
  onView,
  onDelete,
}: {
  swing: SessionSwing;
  first: boolean;
  last: boolean;
  current: boolean;
  thumb: ImageSource | null;
  onView: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  // The SERVER's id: a star is a field on the swing row, so a swing still uploading has nothing
  // to set it on. Disabled for that window rather than swallowing the tap.
  const { starred, toggle, pending: starPending } = useStarred(swing.serverId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Swing ${swing.number}`}
      onPress={onView}
      style={({ pressed }) => [
        styles.row,
        current && { backgroundColor: t.surfaceBlue },
        pressed && styles.pressed,
      ]}
      testID={`session-swing-row-${swing.number}`}
    >
      {/* The rail + dot, `SwingTimelineList`'s construction: half-rail on the ends. */}
      <View style={styles.railBox}>
        <View
          style={[
            styles.rail,
            { backgroundColor: t.surface3 },
            first && { top: "50%" },
            last && { bottom: "50%" },
          ]}
        />
        <LinearGradient colors={[t.aqua, t.cobalt]} style={[styles.dot, { borderColor: t.surface2 }]} />
      </View>

      {thumb ? (
        <Image source={thumb} style={styles.thumb} contentFit="cover" cachePolicy="disk" />
      ) : (
        <View style={[styles.thumb, { backgroundColor: t.surface3 }]} />
      )}

      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.text }]}>{`Swing ${swing.number}`}</Text>
        {swing.status === "analyzing" ? (
          <View style={styles.statusRow}>
            <SwingLoader size={22} />
            <Text style={[styles.statusText, { color: t.muted }]}>analyzing…</Text>
          </View>
        ) : (
          <Text style={[styles.statusText, { color: t.muted }]}>ready</Text>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View swing ${swing.number}`}
        onPress={onView}
        hitSlop={8}
        style={({ pressed }) => [styles.action, { backgroundColor: t.surface3 }, pressed && styles.pressed]}
      >
        <Eye size={16} color={t.muted} strokeWidth={2.2} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete swing ${swing.number}`}
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [styles.action, { backgroundColor: t.surface3 }, pressed && styles.pressed]}
      >
        <Trash2 size={16} color={t.bad} strokeWidth={2.2} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Star swing ${swing.number}`}
        accessibilityState={{ selected: starred, disabled: starPending }}
        disabled={starPending}
        onPress={toggle}
        hitSlop={8}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: t.surface3 },
          starPending && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Star
          size={16}
          color={starred ? t.aqua : t.muted}
          strokeWidth={2.2}
          fill={starred ? t.aqua : "none"}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: 10, overflow: "hidden" },
  /** A swing still uploading has no row to star — dimmed, and the press is off. */
  disabled: { opacity: 0.35 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 76,
    paddingHorizontal: 12,
  },
  railBox: { width: 24, alignSelf: "stretch" },
  rail: { position: "absolute", left: 10, top: 0, bottom: 0, width: 2 },
  dot: {
    position: "absolute",
    left: 4,
    top: "50%",
    marginTop: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    // The mockup's surface halo — a shape-drawing ring, per the borderless rule's carve-out.
    borderWidth: 2,
  },
  thumb: { width: 42, height: 54, borderRadius: 8 },
  rowText: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 10 },
  rowTitle: { fontFamily: FONT_DISPLAY.black, fontSize: 15 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  action: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
});
