import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { ChevronGlyph, DECK } from "../../design/deck";

/**
 * The summary card as a COVER — always on screen, sliding over a video that never moves.
 *
 * The video is fixed behind this; the card rides a full-screen `ScrollView` whose content is a
 * touch-transparent spacer with the card below it. Dragging anywhere on the card IS a native
 * scroll, which is the whole trick: the one gesture system that reliably wins a vertical drag on
 * Android is the `ScrollView` itself, so instead of fighting it from a `PanResponder` (measured
 * failure — see `docs/decisions/mobile-client.md`, D47 keeps gesture-handler out), the card is
 * made OF one. Release inside the travel zone snaps to a detent by drag direction — a slide down
 * parks the card at its bottom peek and exposes the whole video; a slide up brings it to
 * `openTop`. Past `openTop` the same gesture simply reads on through the card, one continuous
 * scroll, no inner scroll view and no hand-off.
 *
 * ## Touches fall through where there is no card
 *
 * Wrapper, scroll view and content container are all `box-none`, and the spacer is `none`, so a
 * tap above the card lands on the transport and the chrome behind this component. Only the card
 * itself takes touches. That is also why the drag surface is "anywhere on the card" and not
 * "anywhere on the glass": the picture's own gestures — scrub, the timeline — live up there.
 *
 * ## Closed is a peek, never gone
 *
 * The closed card keeps `peek` points on screen — the grip, which is both the visual affordance
 * and an accessible button. Controls never hide on this product; a card that vanished entirely
 * would need summoning, which is the exact failure the rule names.
 */

export interface SummaryCoverProps {
  /** The resting detent. The screen owns this; gestures report crossings via `onOpenChange`. */
  open: boolean;
  /** A gesture or the grip crossed the detent — every open/close, however caused. */
  onOpenChange: (open: boolean) => void;
  /** The card's top edge when open, from the cover's own top. */
  openTop: number;
  /** Card height left showing when closed — the pull-up grip. */
  peek: number;
  /** Cleared space under the card's content (safe area, the dock). */
  bottomInset: number;
  children: ReactNode;
  testID?: string;
}

export function SummaryCover({
  open,
  onOpenChange,
  openTop,
  peek,
  bottomInset,
  children,
  testID,
}: SummaryCoverProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const [h, setH] = useState(0);
  /** Last scroll delta's sign — the drag's direction at release, which decides the snap. */
  const lastDyRef = useRef(0);
  const lastYRef = useRef(0);
  const openRef = useRef(open);
  const measured = useRef(false);

  /** Card top when closed sits at `h - peek`; the travel to `openTop` is the snap zone. */
  const spacer = Math.max(0, h - peek);
  const span = Math.max(0, spacer - openTop);
  const spanRef = useRef(span);
  useEffect(() => {
    spanRef.current = span;
  }, [span]);
  /** The golfer has touched the card. Until then, layout changes may re-place it; after, never. */
  const interacted = useRef(false);

  // Mirror written in an effect, never the render body — the scroll callbacks read it.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const settle = useCallback((to: number, animated = true) => {
    scrollRef.current?.scrollTo({ y: to, animated });
  }, []);

  /**
   * Prop-driven placement: the first measurement parks the card at its resting detent with no
   * animation (an entrance from the wrong place is a flash, not a transition); later changes —
   * the screen closing the card for a seek, hardware back — animate.
   */
  useEffect(() => {
    if (h <= 0) return;
    settle(open ? span : 0, measured.current);
    measured.current = true;
  }, [h, open, span, settle]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    if (next > 0) setH((prev) => (prev === next ? prev : next));
  }, []);

  /**
   * The placement effect above can run before the scroll view has content to scroll into —
   * Android clamps the offset to the content it has, which parked the card CLOSED on a screen
   * that asked for it open. Until the golfer touches the card, every content-size change
   * re-places it at its resting detent; after the first touch the position is theirs.
   */
  const onContentSizeChange = useCallback(() => {
    if (interacted.current) return;
    settle(openRef.current ? spanRef.current : 0, false);
  }, [settle]);

  const onScrollBeginDrag = useCallback(() => {
    interacted.current = true;
  }, []);

  /** Hardware back closes the card before it leaves the screen — the sheet idiom, kept. */
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onOpenChange(false);
      return true;
    });
    return () => sub.remove();
  }, [open, onOpenChange]);

  /**
   * The release rule. Inside the travel zone the card is between detents and may not rest there:
   * the drag's direction decides — down parks it (the video is the ask), up opens it — with
   * position deciding only a truly directionless release. At or past `openTop` the golfer is
   * reading; nothing snaps. Runs again at the end of the settle animation, where the early
   * return on the detents makes it a no-op rather than a loop.
   */
  const snap = useCallback(
    (y: number) => {
      const s = spanRef.current;
      if (s <= 0 || y <= 0 || y >= s) return;
      const dy = lastDyRef.current;
      const target = Math.abs(dy) > 1 ? (dy > 0 ? s : 0) : y > s / 2 ? s : 0;
      settle(target);
      const shouldOpen = target !== 0;
      if (shouldOpen !== openRef.current) onOpenChange(shouldOpen);
    },
    [onOpenChange, settle],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastYRef.current;
    if (Math.abs(dy) > 0.5) lastDyRef.current = dy;
    lastYRef.current = y;
  }, []);

  const onRelease = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => snap(e.nativeEvent.contentOffset.y),
    [snap],
  );

  return (
    <View
      style={styles.cover}
      pointerEvents="box-none"
      onLayout={onLayout}
      testID={testID}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.cover}
        pointerEvents="box-none"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onRelease}
        onMomentumScrollEnd={onRelease}
        onContentSizeChange={onContentSizeChange}
        testID={testID ? `${testID}-scroll` : undefined}
      >
        {/* The window onto the video. `none`, so the transport and chrome behind stay live. */}
        <View pointerEvents="none" style={{ height: spacer }} />

        <View
          // Hidden until measured: one frame of card drawn at the wrong detent reads as a flash.
          style={[
            styles.card,
            { minHeight: Math.max(0, h - openTop), paddingBottom: bottomInset + 20 },
            h <= 0 && styles.unmeasured,
          ]}
          testID={testID ? `${testID}-card` : undefined}
        >
          {/* The grip: the drag's visual affordance, and the accessible way to do what a drag
              does — dragging is not available to a screen reader. */}
          <Pressable
            testID={testID ? `${testID}-handle` : undefined}
            accessibilityRole="button"
            accessibilityLabel={open ? "Hide summary" : "Show summary"}
            hitSlop={10}
            onPress={() => onOpenChange(!open)}
            style={({ pressed }) => [styles.header, pressed && styles.pressed]}
          >
            <View style={styles.grip} />
            <ChevronGlyph size={8} color={DECK.label.caption} direction={open ? "down" : "up"} weight={1.8} />
          </Pressable>

          <View style={styles.body}>{children}</View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    // Touches on the spacer region must reach the video behind, not die on the content box.
    pointerEvents: "box-none",
  },
  card: {
    // Solid: the card carries a page of reading, and the swing moving through translucency
    // would sit exactly underneath the text it competes with. No drawn edge — deck surfaces
    // are flat by decree, and the slab shadow is what separates the card from the picture.
    backgroundColor: DECK.ground,
    borderTopLeftRadius: DECK.radius.slab,
    borderTopRightRadius: DECK.radius.slab,
    paddingHorizontal: 18,
    paddingTop: 8,
    boxShadow: DECK.shadow.slab,
  },
  unmeasured: { opacity: 0 },
  header: {
    paddingBottom: 8,
    alignItems: "center",
    gap: 3,
  },
  grip: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  pressed: { opacity: 0.6 },
  body: {},
});
