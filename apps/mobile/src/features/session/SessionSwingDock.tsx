import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  Film,
  ListVideo,
  LogOut,
  Settings,
  Star,
  Trash2,
} from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { DockItem } from "./DockItem";

/**
 * The post-recording dock (§9.6): previous swing · end session · swing list · the big red
 * Record New Swing · delete / favorite / cog as bare icons. Same glass-pill + raised-centre
 * language as the capture dock — the loop's promise is that the next recording is never
 * more than this one button away.
 *
 * The previous-swing slot shows only when a previous swing exists; its real thumbnail
 * arrives with the media wiring — the stub draws the slot with a film glyph.
 */

export interface SessionSwingDockProps {
  hasPrevious: boolean;
  starred: boolean;
  onPrevious: () => void;
  onEndSession: () => void;
  onSwingList: () => void;
  onRecordNew: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onOpenSettings: () => void;
}

export function SessionSwingDock({
  hasPrevious,
  starred,
  onPrevious,
  onEndSession,
  onSwingList,
  onRecordNew,
  onDelete,
  onToggleFavorite,
  onOpenSettings,
}: SessionSwingDockProps) {
  return (
    <View style={styles.dock}>
      {hasPrevious ? (
        <DockItem
          label="Previous Swing"
          onPress={onPrevious}
          testID="session-previous"
          icon={<Film size={17} color={COLORS.muted} strokeWidth={2.2} />}
        />
      ) : null}
      <DockItem
        label="End Session"
        onPress={onEndSession}
        testID="session-end"
        icon={<LogOut size={17} color={COLORS.muted} strokeWidth={2.2} />}
      />
      <DockItem
        label="Swing Log"
        onPress={onSwingList}
        testID="session-swing-list"
        icon={<ListVideo size={17} color={COLORS.muted} strokeWidth={2.2} />}
      />

      <View style={styles.centerSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record new swing"
          onPress={onRecordNew}
          testID="session-record-new"
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <LinearGradient
            colors={["#F0546A", "#E03144"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.recordFace}
          >
            <View style={styles.recordRing} />
          </LinearGradient>
        </Pressable>
        <Text style={styles.centerLabel}>Record New Swing</Text>
      </View>

      <DockItem
        label="Delete"
        showLabel={false}
        onPress={onDelete}
        testID="session-swing-delete"
        icon={<Trash2 size={17} color={COLORS.muted} strokeWidth={2.2} />}
      />
      <DockItem
        label="Favorite"
        showLabel={false}
        active={starred}
        onPress={onToggleFavorite}
        testID="session-swing-favorite"
        icon={
          <Star
            size={17}
            color={starred ? COLORS.aqua : COLORS.muted}
            strokeWidth={2.2}
            fill={starred ? COLORS.aqua : "none"}
          />
        }
      />
      <DockItem
        label="Settings"
        showLabel={false}
        onPress={onOpenSettings}
        testID="session-swing-settings"
        icon={<Settings size={17} color={COLORS.muted} strokeWidth={2.2} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    minHeight: 86,
    marginHorizontal: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16,28,50,0.94)",
  },
  centerSlot: { width: 84, alignItems: "center", gap: 4, marginTop: -18 },
  recordFace: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  recordRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.85)",
  },
  centerLabel: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    textAlign: "center",
  },
  pressed: { opacity: 0.6 },
});
