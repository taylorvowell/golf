import { Image } from "expo-image";
import { View } from "react-native";

import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { useTheme } from "../../theme";
import type { SwingSession } from "./sessions";

/**
 * A session's face on the log — the FIRST swing of the visit, in the header beside the date
 * (Taylor).
 *
 * First rather than newest so the picture is stable: a session's thumbnail changing every time
 * another ball is hit gives the golfer nothing to recognise it by. It sits in the header so a
 * collapsed session is still identifiable at a glance, which is the whole reason it exists.
 *
 * One flat square on purpose (Taylor 2026-08-19) — a stacked-cards treatment was tried for
 * multi-swing sessions and cut; the swings pill already says how big the visit was.
 *
 * `?poster=1` is one frame, not the contact sheet — noise at this size.
 */
export function SessionThumb({
  session,
  size = 56,
  pendingThumb = null,
}: {
  session: SwingSession;
  size?: number;
  /**
   * A locally-extracted frame from an import still on its way into this session.
   *
   * It stands in until the analysed picture exists, so a session that has just been created has
   * a face from the first moment it appears rather than a grey square that fills in minutes
   * later. Ignored once any swing in the session is analysed — a real artifact always wins.
   */
  pendingThumb?: string | null;
}) {
  const t = useTheme();
  /**
   * The first swing that actually HAS a picture — not simply the first swing.
   *
   * `swings[0]` alone left a session blank whenever its earliest swing was unanalysed or failed,
   * which is the common case while a visit is still being recorded: the session's whole reason
   * for a thumbnail is being recognisable at a glance, and it was showing an empty box for a
   * visit that had four analysed swings in it. Ready ones only, because only they have an
   * artifact behind the route; falling back to the first swing keeps the old behaviour when
   * none are.
   */
  const first = session.swings.find((s) => s.status === "ready") ?? session.swings[0];
  const analysed = first?.status === "ready" ? first : null;
  const source = useAuthenticatedImage(analysed ? `swings/${analysed.id}/thumb?poster=1` : null);
  const box = { width: size, height: size, borderRadius: 10 };
  if (!source && pendingThumb) {
    return (
      <Image
        source={{ uri: pendingThumb.startsWith("file://") ? pendingThumb : `file://${pendingThumb}` }}
        style={box}
        contentFit="cover"
        cachePolicy="none"
      />
    );
  }
  if (!source) return <View style={[box, { backgroundColor: t.surface2 }]} />;
  return (
    <Image
      source={source}
      style={box}
      contentFit="cover"
      cachePolicy="disk"
      // Recycled image views keep their last bitmap — key by swing so a reused view clears.
      recyclingKey={analysed?.id}
    />
  );
}
