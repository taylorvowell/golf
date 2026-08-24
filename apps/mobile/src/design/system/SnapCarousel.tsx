import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutAnimation,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { X } from "lucide-react-native";

import { useTheme } from "../../theme";

/**
 * The house carousel: center-aligned cards with both neighbours peeking, snap-to-center on
 * release, an "infinite" loop that never hits a wall, and a uniform dismiss affordance the
 * FRAME renders so every card earns the same X in the same place. Purely presentational —
 * it knows nothing about spotlights, dismissal storage, or eligibility; give it items and
 * callbacks.
 *
 * Built on a core `ScrollView`, deliberately: `react-native-gesture-handler` is excluded
 * from autolinking (D47) and reanimated is not in the app. `SwingSwipe`'s PanResponder is
 * NOT the precedent here — its long comment explains it exists to win responder fights with
 * inner scrub controls, and these cards contain no inner scroll to fight. Pressables inside
 * a card must carry `SCROLL_PRESS_DELAY_MS` (`press.ts`), like every pressable that lives
 * in something that scrolls.
 *
 * **The loop is three copies of the deck.** Start in the middle copy; whenever a settle
 * lands outside it, jump (`animated: false`) to the same logical card in the middle copy.
 * The jump lands on identical pixels, so it is invisible — and it only ever runs at rest,
 * never during a touch. Three copies of a handful of promo cards is a trivial render bill;
 * the index arithmetic a windowed fake-list needs is where the bugs live.
 *
 * **Centering is contentContainer padding, not `contentInset`** — `contentInset` is
 * iOS-only and this app's first device is an Android. With horizontal padding of
 * `PEEK + GAP`, card i sits centered exactly at offset `i * (cardWidth + GAP)`, which is
 * what lets `snapToInterval` do the snapping instead of hand-rolled offset math.
 */

const PEEK = 26;
const GAP = 10;
/** Copies of the deck backing the loop. Middle copy is home; the outer two are runway. */
const COPIES = 3;

export interface SnapCarouselItem {
  /** Stable identity — dismissal and dots key off it. */
  key: string;
  /** The card. Width is supplied (height is the carousel's `cardHeight`); render edge-to-edge. */
  render: (width: number) => ReactNode;
}

export interface SnapCarouselProps {
  items: SnapCarouselItem[];
  /** One height for the whole deck — cards are uniform so the snap geometry is, too. */
  cardHeight: number;
  /** When set, the frame renders the X over the centered card. */
  onDismiss?: (key: string) => void;
  /** Accessibility label for the X, per card. Falls back to a generic label. */
  dismissLabel?: (key: string) => string;
  testID?: string;
}

export function SnapCarousel({
  items,
  cardHeight,
  onDismiss,
  dismissLabel,
  testID,
}: SnapCarouselProps) {
  const t = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  /** Which logical card is centered — drives the dots and the X's target. */
  const [logical, setLogical] = useState(0);
  const logicalRef = useRef(0);
  /** The last content offset the scroll reported — settle handling reads it, not state. */
  const lastX = useRef(0);
  const prevCount = useRef(items.length);

  const n = items.length;
  const cardWidth = Math.max(0, width - 2 * (PEEK + GAP));
  const interval = cardWidth + GAP;
  const looping = n >= 2;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === w ? prev : w));
  }, []);

  const setLogicalIndex = useCallback((next: number) => {
    logicalRef.current = next;
    setLogical((prev) => (prev === next ? prev : next));
  }, []);

  /** Land on the middle copy's first card once geometry exists (and again on a resize). */
  useEffect(() => {
    if (!looping || width === 0) return;
    scrollRef.current?.scrollTo({ x: n * interval, animated: false });
    setLogicalIndex(0);
    // `n` is deliberately not a dependency — deck changes rebase in the effect below, which
    // knows the previously-centered card; re-running this one would yank back to card 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looping, width, interval]);

  /**
   * A dismissal shrank the deck: keep the neighbourhood rather than snapping home. The jump
   * is unanimated and happens the same commit the item vanished, so the deck re-flows in
   * place — the next card slides into the hole (LayoutAnimation, configured by the X).
   */
  useEffect(() => {
    if (prevCount.current === n) return;
    prevCount.current = n;
    if (!looping || width === 0) return;
    const next = Math.min(logicalRef.current, n - 1);
    scrollRef.current?.scrollTo({ x: (n + next) * interval, animated: false });
    setLogicalIndex(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, looping, width, interval]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      lastX.current = x;
      if (interval <= 0 || n === 0) return;
      const index = Math.round(x / interval);
      setLogicalIndex(((index % n) + n) % n);
    },
    [interval, n, setLogicalIndex],
  );

  /**
   * At rest: if the settle left the middle copy, teleport to the same logical card inside
   * it. Both settle events route here — `onMomentumScrollEnd` for the normal snap fling,
   * `onScrollEndDrag` for a release with no momentum at all — and the rebase is idempotent,
   * so hearing both for one gesture is harmless.
   */
  const onSettle = useCallback(() => {
    if (!looping || interval <= 0) return;
    const index = Math.round(lastX.current / interval);
    if (index >= n && index < 2 * n) return;
    const home = n + (((index % n) + n) % n);
    scrollRef.current?.scrollTo({ x: home * interval, animated: false });
  }, [looping, interval, n]);

  const dismissCentered = useCallback(() => {
    const item = items[logicalRef.current];
    if (!item || !onDismiss) return;
    // The reflow (neighbour sliding into the hole, or the whole component collapsing on the
    // last card) is the parent removing the item; configuring here animates that commit.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onDismiss(item.key);
  }, [items, onDismiss]);

  // An empty deck renders NOTHING — the parent slot must collapse, not reserve space.
  if (n === 0) return null;

  const centeredKey = items[Math.min(logical, n - 1)]?.key ?? "";
  const dismissA11y = dismissLabel?.(centeredKey) ?? "Dismiss this card";

  // One card: no loop, no scroll, no dots — a static centered card with the same geometry.
  if (!looping) {
    return (
      <View testID={testID} onLayout={onLayout} style={{ width: "100%" }}>
        {width > 0 ? (
          <View style={{ paddingHorizontal: PEEK + GAP }}>
            <View style={{ width: cardWidth, height: cardHeight }}>
              {items[0].render(cardWidth)}
            </View>
            {onDismiss ? (
              <DismissX label={dismissA11y} onPress={dismissCentered} />
            ) : null}
          </View>
        ) : (
          <View style={{ height: cardHeight }} />
        )}
      </View>
    );
  }

  return (
    <View testID={testID} onLayout={onLayout} style={{ width: "100%" }}>
      {width > 0 ? (
        <>
          <View>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={interval}
              // One card per gesture — a hard fling must not skate past its neighbour.
              disableIntervalMomentum
              decelerationRate="fast"
              onScroll={onScroll}
              scrollEventThrottle={16}
              onMomentumScrollEnd={onSettle}
              onScrollEndDrag={onSettle}
              contentContainerStyle={{
                paddingHorizontal: PEEK + GAP,
                gap: GAP,
              }}
            >
              {Array.from({ length: COPIES }, (_, copy) =>
                items.map((item) => (
                  <View
                    key={`${copy}:${item.key}`}
                    style={{ width: cardWidth, height: cardHeight }}
                  >
                    {item.render(cardWidth)}
                  </View>
                )),
              )}
            </ScrollView>
            {onDismiss ? (
              <DismissX label={dismissA11y} onPress={dismissCentered} />
            ) : null}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 10 }}>
            {items.map((item, i) => (
              <View
                key={item.key}
                style={{
                  width: i === logical ? 14 : 5,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: i === logical ? t.aqua : t.surface3,
                }}
              />
            ))}
          </View>
        </>
      ) : (
        <View style={{ height: cardHeight }} />
      )}
    </View>
  );
}

/**
 * The frame's dismiss affordance — one X, one place, over whichever card is centered, so
 * every card is dismissed the same way (and a bespoke card cannot forget to offer it).
 * Sits OUTSIDE the ScrollView, so its press is never claimed by the scroll gesture and it
 * keeps instant feedback. Press is a fill step up the ramp, per the tap-state rule.
 */
function DismissX({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => ({
        position: "absolute",
        top: 8,
        right: PEEK + GAP + 8,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.surface3 : t.surface2,
      })}
    >
      <X size={15} color={t.muted} strokeWidth={2.5} />
    </Pressable>
  );
}
