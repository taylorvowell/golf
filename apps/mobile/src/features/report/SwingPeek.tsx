import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { APP_HEADER_BAR } from "../../design/system";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import type { SwingEntry } from "../swings/sessions";
import { SwingHeading } from "./SwingHeading";
import { swingAspectRatio } from "./SwingPage";

/**
 * The neighbouring swing during a sideways drag — its first frame and its heading, on the
 * player's own ground.
 *
 * A still, not a player: three decoders on one screen is what wedges a phone, and the real layer
 * paints this exact frame as its poster while its video warms up, so the moment the slide lands
 * the picture does not change. The stage is sized with the same `fitBox` the layer uses, so the
 * frame does not resize under the golfer as the page becomes live either.
 *
 * No transport, no orbs, no card. It is on screen for the length of a drag and every control on
 * it would be unpressable — this is the picture arriving, not a second copy of the page.
 */
export function SwingPeek({ entry }: { entry: SwingEntry }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const source = useAuthenticatedImage(`swings/${entry.swing.id}/frame?f=0`);

  const aspect = swingAspectRatio(entry.swing) ?? 9 / 16;
  const byWidth = width / aspect;
  const stage = byWidth <= height ? { w: width, h: byWidth } : { w: height * aspect, h: height };

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.stageRow}>
        <View style={[styles.stage, { width: stage.w, height: stage.h }]}>
          {source ? (
            <Image
              source={source}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              // memory-disk, not disk: this exact bitmap was on the glass a frame ago (the
              // drag's neighbour peek), and a disk-only policy re-DECODES it on every mount —
              // one to three frames of bare black stage at the commit, which is the "very
              // fast flash of black" between swings (Taylor, 2026-08-22). The memory cache
              // makes the remount paint in the same frame.
              cachePolicy="memory-disk"
              transition={0}
              // Peeks mount and unmount on every swipe — prime candidates for expo-image's view
              // recycling handing one the PREVIOUS swing's bitmap. Same fix as the poster.
              recyclingKey={entry.swing.id}
            />
          ) : null}
        </View>
      </View>
      <View style={[styles.heading, { top: insets.top + APP_HEADER_BAR }]}>
        <SwingHeading entry={entry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The video layer's own backdrop colour — the strip beside a narrow clip has to match, or the
  // page arriving reads as a different screen.
  root: { flex: 1, backgroundColor: "#081426" },
  stageRow: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  stage: { backgroundColor: "#000", overflow: "hidden" },
  // Left-aligned, clear of the corner orb column on the right. Must match the page.
  heading: { position: "absolute", left: 16, right: 68 },
});
