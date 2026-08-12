import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";

import { DECK } from "../../design/deck";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import type { PhaseBand } from "./phaseBands";
import type { Extent } from "./frames";
import { useSeekSurface } from "./useSeekSurface";

/**
 * The swing itself, as a strip you can drag along.
 *
 * ## One image, not twelve
 *
 * The analyzer writes `filmstrip.jpg` — a single row of twelve clean frames sampled across
 * `playback_window` — and this draws it whole, stretched to the strip's width. Twelve separate
 * thumbnail requests would be twelve round trips and twelve decodes on a product used on a course
 * on cellular; the strip is one ~30–60 KB fetch that expo-image then caches to disk.
 *
 * Drawing it whole also means **the picture is continuous**, so dragging along it is dragging
 * through the swing rather than stepping between cells. The film sprockets are drawn on top as
 * hairlines; they are decoration and cost no layout.
 *
 * ## It is the analyzer's frames, not the analysis
 *
 * Clean video: no skeleton, no stamped numbers. `contact.jpg` has both and exists for exactly the
 * opposite purpose — reading a swing at a glance in a debug folder. Two different renderings of
 * the same pose a centimetre apart, disagreeing, is a bug report waiting to happen.
 *
 * ## Absent is normal
 *
 * A swing analysed before this artifact existed answers 404, and then the strip is just the phase
 * bar: still scrubbable, still drawn to scale, simply without pictures. Nothing here fabricates a
 * frame it could not fetch.
 *
 * One imprecision, recorded rather than hidden: cell *centres* sit at evenly-spaced frames, so the
 * picture under the playhead can be up to half a cell — about 4% of the swing — from the frame the
 * playhead names. It is a preview strip, and the video above it is the authority.
 */

export interface FilmstripScrubberProps {
  swingId: string;
  view?: string | null;
  /** The transport's span. The strip was sampled across the same one. */
  bounds: Extent;
  onSeek: (frame: number) => void;
  /** Phases, drawn to scale, as a band under the pictures. Empty on a swing with no artifact. */
  bands: readonly PhaseBand[];
  disabled?: boolean;
}

/** Cells in the strip. A CONTRACT with `swingsage/render.py` — it bakes the same number. */
const CELLS = 12;
/** One cell, in the sprite. The strip's aspect follows from these two. */
const CELL_W = 120;
const CELL_H = 160;

export function FilmstripScrubber({
  swingId,
  view,
  bounds,
  onSeek,
  bands,
  disabled = false,
}: FilmstripScrubberProps) {
  const strip = useAuthenticatedImage(
    `swings/${swingId}/filmstrip${view ? `?view=${encodeURIComponent(view)}` : ""}`,
  );
  const surface = useSeekSurface(bounds, onSeek, disabled);
  const total = bands.reduce((sum, b) => sum + (b.to - b.from), 0);

  return (
    <View
      testID="filmstrip"
      style={styles.wrap}
      onLayout={surface.onLayout}
      {...surface.panHandlers}
    >
      <View style={styles.frames}>
        {strip ? (
          <Image
            testID="filmstrip-image"
            source={strip}
            style={styles.image}
            // `fill`, not `cover`: the container's aspect ratio IS the sprite's, so filling is
            // exact and cover would crop a sliver off every cell for nothing.
            contentFit="fill"
            // Disk-cached. The strip does not change unless the swing is re-analysed, and that
            // mints a new revision in the URL.
            cachePolicy="disk"
            transition={140}
          />
        ) : (
          <View style={styles.empty} />
        )}

        {/* Sprockets. Drawn over the picture rather than as gaps between cells, because a gap
            would be taken out of the row before the width was divided — and then the strip
            would no longer agree with the playhead about where a frame is. */}
        <View style={styles.sprockets} pointerEvents="none">
          {Array.from({ length: CELLS - 1 }, (_, i) => (
            <View key={i} style={[styles.sprocket, { left: `${((i + 1) / CELLS) * 100}%` }]} />
          ))}
        </View>
      </View>

      {/* Phases, to scale. Backswing against downswing, drawn to width, IS tempo — which is why
          this survives having pictures above it rather than being replaced by them. */}
      {total > 0 ? (
        <View style={styles.phases} pointerEvents="none" testID="phase-bar">
          {bands.map((b) => (
            <View
              key={b.key}
              style={{
                flexGrow: b.to - b.from,
                flexShrink: b.to - b.from,
                flexBasis: 0,
                backgroundColor: b.color,
                opacity: b.padding ? 0.4 : 1,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 3 },
  frames: {
    width: "100%",
    // The sprite's own shape, so `fill` is lossless: 12 cells of 120x160.
    aspectRatio: (CELLS * CELL_W) / CELL_H,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  image: { width: "100%", height: "100%" },
  empty: { width: "100%", height: "100%" },
  sprockets: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" },
  sprocket: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  phases: {
    flexDirection: "row",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: DECK.glass.key,
  },
});
