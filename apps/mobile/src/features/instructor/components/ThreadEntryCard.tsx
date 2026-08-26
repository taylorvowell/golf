import { Text, View } from "react-native";
import {
  ClipboardCheck,
  Dumbbell,
  MessageSquare,
  PlaySquare,
  Search,
  Video,
} from "lucide-react-native";

import { FONT_BODY } from "../../../design/system/typography";
import { themedStyles, useTheme } from "../../../theme";
import type { ThreadEntry } from "../mock/types";

/**
 * One entry in the D60 conversation feed — TYPED RICH CARDS, never plain bubbles: a lesson, a
 * review request, a drill assignment, a plan update and a shared swing each wear their kind
 * (glyph + title) so the thread reads as the product's coaching record, not a chat app. The
 * lesson list and the review queue are views over this same log later.
 *
 * `perspective` flips the alignment: the same entry renders on the instructor's side of the
 * instructor's screen and the instructor's side of the STUDENT's screen — one component, both
 * halves of the loop, so the two can never drift apart.
 */

const KIND_GLYPH = {
  message: MessageSquare,
  feedback: MessageSquare,
  lesson: Video,
  review_request: Search,
  drill_assignment: Dumbbell,
  plan_update: ClipboardCheck,
  shared_swing: PlaySquare,
} as const;

export function ThreadEntryCard({
  entry,
  perspective,
}: {
  entry: ThreadEntry;
  perspective: "instructor" | "student";
}) {
  const t = useTheme();
  const styles = useStyles();
  const mine = entry.from === perspective;
  const Glyph = KIND_GLYPH[entry.kind];
  const typed = entry.kind !== "message";

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.card, mine ? styles.cardMine : styles.cardTheirs]}>
        {typed && (
          <View style={styles.kindRow}>
            <Glyph size={13} color={mine ? t.onDark : t.aqua} strokeWidth={2.4} />
            {entry.title != null && (
              <Text style={[styles.kindTitle, mine && styles.inkMine]} numberOfLines={1}>
                {entry.title}
              </Text>
            )}
          </View>
        )}
        <Text style={[styles.body, mine && styles.inkMine]}>{entry.body}</Text>
        <Text style={[styles.meta, mine && styles.metaMine]}>
          {entry.ageLabel}
          {/* Only the SENDER sees the broadcast mark — the student's copy reads personal. */}
          {entry.fromBroadcast && perspective === "instructor" ? " · sent to all students" : ""}
        </Text>
      </View>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  card: { maxWidth: "84%", borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, gap: 3 },
  cardMine: { backgroundColor: t.cobalt, borderTopRightRadius: 6 },
  cardTheirs: { backgroundColor: t.surface2, borderTopLeftRadius: 6 },
  kindRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kindTitle: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 12.5, flexShrink: 1 },
  body: { color: t.text, fontFamily: FONT_BODY.regular, fontSize: 13.5, lineHeight: 19 },
  inkMine: { color: t.onDark },
  meta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 10.5 },
  metaMine: { color: "rgba(255,255,255,0.75)" },
}));
