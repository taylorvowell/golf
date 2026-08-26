import { useEffect, useState } from "react";
import { Image } from "expo-image";

import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import type { SwingSession } from "./sessions";
import { PoseTile } from "./SwingThumb";

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
  /**
   * The first swing that actually HAS a picture — preferring an analysed one.
   *
   * A ready swing carries the analyzer's contact frame; any other swing now carries the poster
   * its own upload sent (thumb route falls back to it), so the request is made for the first
   * swing regardless of status — an analysing visit gets its face from the first second rather
   * than minutes later.
   */
  const first = session.swings.find((s) => s.status === "ready") ?? session.swings[0];
  const source = useAuthenticatedImage(first ? `swings/${first.id}/thumb?poster=1` : null);
  /** The route said 404 — nothing at all behind this swing yet. */
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [first?.id]);
  const box = { width: size, height: size, borderRadius: 10 };
  if ((!source || failed) && pendingThumb) {
    return (
      <Image
        source={{ uri: pendingThumb.startsWith("file://") ? pendingThumb : `file://${pendingThumb}` }}
        style={box}
        contentFit="cover"
        cachePolicy="none"
      />
    );
  }
  if (!source || failed || !first) {
    return <PoseTile view={first?.view} size={size} radius={10} />;
  }
  return (
    <Image
      source={source}
      style={box}
      contentFit="cover"
      cachePolicy="disk"
      onError={() => setFailed(true)}
      // Recycled image views keep their last bitmap — key by swing so a reused view clears.
      recyclingKey={first.id}
    />
  );
}
