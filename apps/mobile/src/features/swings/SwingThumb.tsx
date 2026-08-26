import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { PoseOutline, Skeleton } from "../../design/system";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { useTheme } from "../../theme";

/**
 * One swing's own face — the contact frame, small, at the left of its row on the log.
 *
 * The session's thumbnail says which VISIT this was; at the row level the useful question is
 * which swing, and ten rows of the same date differ only in the picture. `?poster=1` is one
 * frame rather than the contact sheet: at this size a sheet is noise.
 *
 * The route serves the analyzer's contact frame once it exists and the client-uploaded poster
 * before that, so a swing normally has a picture from its first second. When neither exists —
 * an old swing from before posters, a poster that failed to land — the tile shows the view's
 * POSE OUTLINE (the record screen's own figure, Taylor 2026-08-26): still says "a golfer,
 * from this angle" rather than an empty square.
 */
/** The row's picture box. Shared with the arriving row's ghost, so nothing shifts when the real
 *  thumbnail replaces it. */
export const SWING_THUMB = 34;

/** The no-picture tile: the capture pose for this angle, quiet, on the surface ramp. */
export function PoseTile({
  view,
  size,
  radius = 8,
}: {
  view: string | null | undefined;
  size: number;
  radius?: number;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: t.surface3,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PoseOutline
        pose={view === "face_on" ? "face_on" : "dtl"}
        width={size * 0.55}
        height={size * 0.66}
        color={t.muted}
        fill
      />
    </View>
  );
}

export function SwingThumb({
  swing,
  size = SWING_THUMB,
}: {
  swing: SwingSummary;
  size?: number;
}) {
  const source = useAuthenticatedImage(`swings/${swing.id}/thumb?poster=1`);
  /** The route said 404 — nothing to show for THIS swing. Reset when the row is recycled. */
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [swing.id]);
  const box = { width: size, height: size, borderRadius: 8 };
  if (!source || failed) return <PoseTile view={swing.view} size={size} />;
  return (
    <Image
      source={source}
      style={box}
      contentFit="cover"
      cachePolicy="disk"
      onError={() => setFailed(true)}
      // List rows recycle image views — without the key a row can flash another swing's frame.
      recyclingKey={swing.id}
    />
  );
}

/**
 * The same box, breathing, for a swing that does not exist yet.
 *
 * White at low alpha rather than `Skeleton`'s default `surface2`: this only ever sits on the
 * arriving row's COBALT card, and the surface ramp has nothing to say on a fill that is not part
 * of it.
 */
export function SwingThumbGhost({ size = SWING_THUMB }: { size?: number }) {
  return (
    <Skeleton
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        backgroundColor: "rgba(255,255,255,0.24)",
      }}
    />
  );
}

/**
 * The picked clip's own frame, for a swing that is still on its way up.
 *
 * A real picture of the real video beats a breathing rectangle: it tells the golfer WHICH clip is
 * uploading, which matters the moment they import a second one. Same box as every other row, so
 * nothing shifts when the analysed thumbnail replaces it.
 */
export function SwingThumbLocal({
  path,
  size = SWING_THUMB,
}: {
  path: string;
  size?: number;
}) {
  return (
    <Image
      source={{ uri: path.startsWith("file://") ? path : `file://${path}` }}
      style={{ width: size, height: size, borderRadius: 8 }}
      contentFit="cover"
      // A cache key would outlive the file, which is deleted with the rest of the capture cache.
      cachePolicy="none"
    />
  );
}

/**
 * The same box again, carrying an error mark, for an import that did not make it.
 *
 * It replaces the picture rather than sitting beside it because there IS no picture — the swing
 * has no frame to show, and a breathing ghost where the thumbnail goes would keep promising one
 * that is never coming.
 */
export function SwingThumbFailed({ size = SWING_THUMB }: { size?: number }) {
  return (
    <View
      accessible
      accessibilityLabel="This swing could not be added"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.18)",
      }}
    >
      <AlertTriangle size={Math.round(size * 0.55)} color="#FFFFFF" strokeWidth={2.4} />
    </View>
  );
}
