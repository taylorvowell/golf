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
export function SessionThumb({ session, size = 56 }: { session: SwingSession; size?: number }) {
  const t = useTheme();
  const first = session.swings[0];
  const source = useAuthenticatedImage(first ? `swings/${first.id}/thumb?poster=1` : null);
  const box = { width: size, height: size, borderRadius: 10 };
  if (!source) return <View style={[box, { backgroundColor: t.surface2 }]} />;
  return <Image source={source} style={box} contentFit="cover" cachePolicy="disk" />;
}
