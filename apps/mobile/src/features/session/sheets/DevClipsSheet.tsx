import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { RotateCw, Video } from "lucide-react-native";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_DISPLAY } from "../../../design/system/typography";
import { appStyles, useAppTheme } from "../../../theme";
import type { DevClipRow, DevClipsDrawer } from "../useDevClips";
import type { CaptureView } from "../sessionState";

/**
 * The clip library — pre-recorded swings, triaged (`__DEV__` only).
 *
 * A flat list of file names was not enough to work through twenty takes: with no picture every
 * row looks alike, and with no memory of what has been tried the same four rejects get opened
 * again after every reload. So each row carries the three things a verdict actually needs — the
 * frame, the name, and what happened last time.
 *
 * **The angle tag is the load-bearing control, not the thumbnail.** It is guessed from the file
 * name and it is a guess; a front-view clip stamped `dtl` inverts every lead/trail metric the
 * analyzer computes downstream, and that failure looks like bad analysis rather than bad
 * metadata. Tapping the tag corrects it, and the correction persists with the clip.
 *
 * Dense on purpose, like `DebugSheet` — this is a power-user surface, and nothing on it is
 * subject to the no-instruments rule that governs a golfer's screens.
 */

const STATUS_LABEL: Record<DevClipRow["status"], string> = {
  new: "NEW",
  tried: "TRIED",
  saved: "SAVED",
};

const VIEW_LABEL: Record<CaptureView, string> = { dtl: "DTL", face_on: "FRONT" };

export interface DevClipsSheetProps {
  drawer: DevClipsDrawer;
}

export function DevClipsSheet({ drawer }: DevClipsSheetProps) {
  const t = useAppTheme();
  const styles = useStyles();
  const { open, setOpen, rows, folder, inject, setView, rescan } = drawer;

  return (
    <Sheet
      visible={open}
      onClose={() => setOpen(false)}
      title="Clip library"
      titleIcon={<Video size={15} color={t.cobalt} strokeWidth={2.5} />}
      subtitle={rows.length ? undefined : folderHint(folder)}
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rescan the clip folder"
          onPress={rescan}
          style={({ pressed }) => [styles.rescan, pressed && styles.pressed]}
          testID="dev-clips-rescan"
        >
          <RotateCw size={12} color={t.cobalt} strokeWidth={2.5} />
          <Text style={styles.rescanLabel}>Rescan</Text>
        </Pressable>
      }
      scrolls
      maxHeightFraction={0.86}
      restHeightFraction={0.7}
      testID="dev-clips-sheet"
    >
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {rows.map((row) => (
          <View key={row.path} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Load ${row.name} as a take`}
              onPress={() => inject(row)}
              style={({ pressed }) => [styles.main, pressed && styles.pressed]}
              testID={`dev-clip-${row.name}`}
            >
              {row.thumbUri ? (
                <Image source={{ uri: row.thumbUri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]} />
              )}
              <View style={styles.text}>
                {/* The file name is the identity — never elided to two lines, because the
                    difference between two takes is usually the last few characters. */}
                <Text style={styles.name} numberOfLines={2}>
                  {row.name}
                </Text>
                <Text style={styles.meta}>
                  {Math.round(row.durationMs / 1000)}s · {Math.round(row.fps)}fps ·{" "}
                  {Math.round(row.sizeBytes / 1e6)}MB
                </Text>
              </View>
            </Pressable>

            <View style={styles.tags}>
              <View style={[styles.status, statusStyle(row.status, t)]}>
                <Text style={[styles.statusLabel, { color: statusColor(row.status, t) }]}>
                  {STATUS_LABEL[row.status]}
                </Text>
              </View>
              {/* Tap to flip the angle. Two options, so a toggle beats a picker. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.name} was filmed ${
                  row.view === "dtl" ? "down the line" : "face on"
                } — tap to change`}
                onPress={() => setView(row, row.view === "dtl" ? "face_on" : "dtl")}
                style={({ pressed }) => [styles.view, pressed && styles.pressed]}
                testID={`dev-clip-view-${row.name}`}
              >
                <Text style={styles.viewLabel}>{VIEW_LABEL[row.view]}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** An empty library has one job: say where the files go, in the name the PC uses for it. */
function folderHint(folder: string | null): string {
  if (!folder) return "No clip folder available on this device.";
  return `Put clips in ${folder.replace(/^\/storage\/emulated\/0\/?/, "Internal storage/")}`;
}

function statusColor(status: DevClipRow["status"], t: ReturnType<typeof useAppTheme>): string {
  if (status === "saved") return t.aqua;
  if (status === "tried") return t.muted;
  return t.cobalt;
}

function statusStyle(status: DevClipRow["status"], t: ReturnType<typeof useAppTheme>) {
  return { backgroundColor: status === "saved" ? `${t.aqua}22` : t.surface2 };
}

const useStyles = appStyles((t) => ({
  list: { gap: 6, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 6,
    borderRadius: 12,
    backgroundColor: t.surface,
  },
  main: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, borderRadius: 9 },
  /** Portrait, because the clips are — a landscape box would letterbox every frame. */
  thumb: { width: 38, height: 54, borderRadius: 7, backgroundColor: t.surface2 },
  thumbEmpty: { opacity: 0.5 },
  text: { flex: 1, gap: 2 },
  name: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 12 },
  meta: { color: t.muted2, fontFamily: FONT_DISPLAY.extraBold, fontSize: 10 },
  tags: { alignItems: "flex-end", gap: 5 },
  status: { paddingHorizontal: 7, height: 18, borderRadius: 9, justifyContent: "center" },
  statusLabel: { fontFamily: FONT_DISPLAY.black, fontSize: 8, letterSpacing: 0.8 },
  view: {
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  viewLabel: { color: t.text, fontFamily: FONT_DISPLAY.black, fontSize: 9, letterSpacing: 0.8 },
  rescan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    backgroundColor: t.surface,
  },
  rescanLabel: { color: t.cobalt, fontFamily: FONT_DISPLAY.extraBold, fontSize: 10 },
  // Pressed is a FILL, never opacity (mobile-client register).
  pressed: { backgroundColor: t.surface2 },
}));
