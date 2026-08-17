import { Pressable, StyleSheet, Text, View } from "react-native";

import { ChevronGlyph, DECK, DeckButton, PlayGlyph } from "../../design/deck";
import { COLORS } from "../../theme";

/**
 * The after-swing footer — the four things a golfer does the moment a swing has been reviewed:
 * record the next one, keep this one, delete it, or watch it back.
 *
 * It has two states, chosen by the caller. **Expanded** is the full strip. **Collapsed** is just
 * the tab — while the golfer is watching the video the menu folds away so the transport is the
 * bottom-most control, and scrolling down into the stats (or tapping the tab) brings it back.
 * The tab is always on screen: the menu is never *gone*, only folded.
 *
 * Record is the primary cap — exactly one per surface — and is a *circle* because that is what
 * every camera the golfer has ever used taught them. The confirmation for delete lives with the
 * caller: this dock is presentation, and a destructive decision belongs beside the code that can
 * actually do it.
 */

export interface AfterSwingDockProps {
  starred: boolean;
  onToggleStar: () => void;
  /** Asked to delete — the caller confirms and deletes. */
  onDelete: () => void;
  onRecord: () => void;
  /** Reveal the video and play it. */
  onPlay: () => void;
  /** Folded down to the tab. */
  collapsed: boolean;
  /** The tab was pressed. What that reveals (the menu, the summary) is the caller's to decide. */
  onHandle: () => void;
  /** What the tab does, for a screen reader. */
  handleLabel: string;
  bottomInset: number;
  testID?: string;
}

/** The full dock's height above the safe-area inset. */
export const DOCK_BODY_HEIGHT = 118;
/** Just the tab. */
export const DOCK_TAB_HEIGHT = 30;

export function AfterSwingDock({
  starred,
  onToggleStar,
  onDelete,
  onRecord,
  onPlay,
  collapsed,
  onHandle,
  handleLabel,
  bottomInset,
  testID,
}: AfterSwingDockProps) {
  const height = (collapsed ? DOCK_TAB_HEIGHT : DOCK_BODY_HEIGHT) + bottomInset;
  return (
    <View testID={testID} style={[styles.dock, { height, paddingBottom: collapsed ? 0 : bottomInset }]}>
      <Pressable
        testID={testID ? `${testID}-handle` : undefined}
        accessibilityRole="button"
        accessibilityLabel={handleLabel}
        hitSlop={8}
        onPress={onHandle}
        style={({ pressed }) => [styles.handle, pressed && styles.pressed]}
      >
        <View style={styles.handleBar} />
        <ChevronGlyph
          size={8}
          color={DECK.label.caption}
          direction={collapsed ? "up" : "down"}
          weight={1.8}
        />
      </Pressable>

      {collapsed ? null : (
        <View style={styles.row}>
          <View style={styles.side}>
            <DeckButton
              testID={testID ? `${testID}-delete` : undefined}
              accessibilityLabel="Delete this swing"
              diameter={50}
              onPress={onDelete}
            >
              <TrashGlyph size={17} color={DECK.label.onFace} />
            </DeckButton>
            <DeckButton
              testID={testID ? `${testID}-star` : undefined}
              accessibilityLabel={starred ? "Unstar this swing" : "Star this swing"}
              diameter={50}
              depressed={starred}
              onPress={onToggleStar}
            >
              {/* A five-point star is a concave path — SVG, which this app deliberately does not
                  ship — so this is the system font's, the same stopgap the scorecard's ✓ uses.
                  The app icon set is `mobile-app-shell` step 03's. */}
              <Text style={[styles.star, starred && styles.starOn]}>{starred ? "★" : "☆"}</Text>
            </DeckButton>
          </View>

          <DeckButton
            testID={testID ? `${testID}-record` : undefined}
            accessibilityLabel="Record a new swing"
            diameter={68}
            primary
            onPress={onRecord}
          >
            <View style={styles.recordDot} />
          </DeckButton>

          <View style={[styles.side, styles.sideRight]}>
            <DeckButton
              testID={testID ? `${testID}-play` : undefined}
              accessibilityLabel="Play the swing"
              diameter={50}
              onPress={onPlay}
            >
              <PlayGlyph size={15} color={DECK.label.onFace} />
            </DeckButton>
          </View>
        </View>
      )}
    </View>
  );
}

/** A trash can in three rectangles — lid knob, lid, body — per the no-icon-font rule. */
function TrashGlyph({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.14,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          backgroundColor: color,
        }}
      />
      <View style={{ width: size, height: size * 0.12, borderRadius: 1, backgroundColor: color }} />
      <View
        style={{
          marginTop: size * 0.1,
          width: size * 0.72,
          height: size * 0.62,
          borderWidth: 1.6,
          borderColor: color,
          borderBottomLeftRadius: size * 0.2,
          borderBottomRightRadius: size * 0.2,
          borderTopLeftRadius: 1,
          borderTopRightRadius: 1,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Opaque on purpose: content scrolls behind this dock, and a glass dock would show a strip
    // of it through itself.
    backgroundColor: DECK.ground,
  },
  handle: {
    height: DOCK_TAB_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  handleBar: {
    width: 34,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  pressed: { opacity: 0.6 },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingBottom: 10,
  },
  side: { flex: 1, flexDirection: "row", gap: 14, alignItems: "center" },
  sideRight: { justifyContent: "flex-end" },
  star: { fontSize: 21, lineHeight: 24, color: DECK.label.onFace },
  starOn: { color: DECK.accent },
  recordDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.onAqua,
  },
});
