import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

/**
 * Swipe sideways to move to the next swing (Taylor, 2026-08-22).
 *
 * The gesture carries the PICTURE, not a menu: the whole video area travels with the finger and
 * the neighbouring swing comes in behind it, so at every moment of the drag both swings are on
 * screen. A control that jumped to the next swing on release would be a button worn as a gesture.
 *
 * ## Why `PanResponder` and not a paging `ScrollView`
 *
 * A horizontal `ScrollView` would give this for free, but it would also become an ancestor of the
 * scrub, whose own `PanResponder` grants on touch-down — a native scroller and a JS responder
 * fighting over the same horizontal drag is exactly the bug that makes a scrub feel unreliable.
 * `PanResponder` inverts it: the scrub (and every `Pressable` over the picture) claims the touch
 * first, and this only ever takes over from a drag that is unambiguously sideways.
 * `react-native-gesture-handler` is excluded from autolinking (D47), the same reason `SideDrawer`
 * and the sheets are built this way.
 *
 * ## What the neighbours are
 *
 * Stills, never players. Three live decoders on one screen is what wedges a mid-range phone, and
 * the incoming page's first frame is the poster the real layer paints under its own video anyway
 * — same URL, same `contentFit`, same disk cache — so the hand-off at the end of the slide is the
 * same image rather than a swap.
 *
 * ## The recentre happens AFTER the swap, never before it
 *
 * This is the whole reason the transition used to flicker (Taylor, 2026-08-22: "it flashes the new
 * video and then flashes the old swing it slid from, then comes back"). Recentring in the
 * animation's completion callback puts the container back at 0 while React is still holding the
 * OLD page — so the frame that paints is the swing you just swiped away from, centred, and only
 * the render after that shows the right one.
 *
 * So the container STAYS at ±width until `currentKey` actually changes, and the recentre runs in a
 * layout effect. The gesture is locked for that window because a second swipe starting from an
 * uncommitted position would compound the offset.
 *
 * ## And a still COVERS the swap, because the recentre alone cannot be trusted to land in time
 *
 * `x` is native-driven, so `setValue` goes down the native-animated queue — a different queue from
 * the one carrying React's mount. The two are not ordered against each other, and when the
 * transform lands one frame early the container is back at centre while the OLD page is still
 * mounted: a single frame of the previous swing, overlay and all, right before the new one starts
 * playing (Taylor, 2026-08-22 — the flicker that survived the layout-effect fix).
 *
 * A frame that cannot be ordered has to be hidden instead. `cover` — a still of the swing being
 * moved TO — is DERIVED from "has the current swing painted yet", so the commit that swaps the
 * page renders it by construction, and it sits OUTSIDE the animated container so nothing the
 * transform does can move it. The recentre itself is deferred one animation frame, so it can only
 * ever apply under that cover.
 *
 * **It releases on the incoming player's FIRST PAINTED FRAME, never on a timer** (Taylor,
 * 2026-08-22 — the flicker outlived a timed cover). The gap it hides is "token resolve + decoder
 * prepare", which takes however long it takes; a fixed 300ms fade routinely ended while the page
 * under it was still showing its poster — and expo-image can hand that poster a RECYCLED native
 * view still holding the previous swing's bitmap, which is the flash itself. The host reports the
 * new player's first real frame through `coverReadyKey`, and only then does the cover fade — onto
 * a picture that is now, by definition, the playing video. A safety timeout releases a cover over
 * a video that will never paint (a broken clip must not brick the gesture forever).
 */

/** Sideways travel before this takes the touch off whatever was holding it. */
const CLAIM_PX = 10;
/** How much more sideways than vertical the drag has to be — the vertical scroll always wins. */
const HORIZONTAL_BIAS = 1.3;
/**
 * Past this much of the screen, the release lands on the neighbour instead of springing back.
 *
 * Deliberately low (Taylor, 2026-08-22): moving through swings is the most repeated gesture on
 * this screen, and a threshold that asks for a third of the screen turns "next swing" into a
 * deliberate drag every time. The vertical scroll is protected by `HORIZONTAL_BIAS`, not by
 * making the horizontal gesture expensive.
 */
const COMMIT_FRACTION = 0.14;
/** Or a flick, whatever the distance — `PanResponder` velocity is px/ms. */
const COMMIT_VELOCITY = 0.25;

/**
 * The drag's chrome signal: 1 at rest, falling to 0 as the page travels (Taylor, 2026-08-22 —
 * "fade out previous controls as it's swiped"). A native-driven interpolation of the swipe's own
 * x, shared by context so the page's video layer can multiply it onto its controls without the
 * two components holding hands through six prop layers. Null outside a swipe host — consumers
 * treat that as "always 1".
 */
export const SwipeChromeContext = createContext<Animated.AnimatedInterpolation<number> | null>(
  null,
);

export interface SwingSwipeProps {
  /**
   * The swing on screen. NOT used for rendering — it is the signal that the host has committed
   * the swap, which is what the recentre waits for.
   */
  currentKey: string;
  /** The page one step back in the log — omit at the newest swing and the drag will not start. */
  prev: ReactNode;
  /** The page one step forward. Omit at the oldest. */
  next: ReactNode;
  /**
   * False while the golfer is reading the analysis: the card is what the screen is about then,
   * and sliding the whole page sideways under an open scorecard is not what a sideways drag over
   * a report means.
   */
  enabled?: boolean;
  /** The slide landed — the host makes that neighbour the current swing. */
  onGo: (step: -1 | 1) => void;
  /**
   * A still of the CURRENT swing, drawn over everything for the moment after a swap.
   *
   * The host passes the same peek it passes as a neighbour, for the swing `currentKey` names —
   * so at the moment this is shown it is already the incoming swing's own picture.
   */
  cover?: ReactNode;
  /**
   * The key of the swing whose player has painted its first real frame. The cover holds until
   * this equals `currentKey` — the only signal that there is truly a picture underneath.
   */
  coverReadyKey?: string | null;
  children: ReactNode;
}

export function SwingSwipe({
  currentKey,
  prev,
  next,
  enabled = true,
  onGo,
  cover,
  coverReadyKey,
  children,
}: SwingSwipeProps) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;

  /**
   * Between the slide landing and the host swapping the page in. The gesture is dead here: a
   * second swipe from an uncommitted position would start its own drag from ±width.
   */
  const committing = useRef(false);
  const settledKey = useRef(currentKey);
  useLayoutEffect(() => {
    if (settledKey.current === currentKey) return;
    settledKey.current = currentKey;
    // ONE FRAME LATER, not in the effect body. `x` is native-driven, so `setValue` travels a
    // different queue from the mount of this very commit, and nothing orders the two — a
    // recentre that lands first paints the old tree centred for a frame. By the next animation
    // frame the commit (cover included) is on the glass, so whenever the recentre applies, it
    // applies under the cover.
    const raf = requestAnimationFrame(() => {
      x.setValue(0);
      committing.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [currentKey, x]);

  /**
   * The covering still, fully DERIVED: it shows whenever the swing on screen has not painted a
   * frame yet, which by construction includes the commit that swapped it in.
   *
   * This replaced an imperative `setCovering(true)` fired next to `onGo` — two setStates in two
   * different components, whose batching into one commit was an assumption. Derived, there is no
   * second state to race: the render that first sees the new `currentKey` computes "not painted
   * yet" in the same pass, so the cover cannot miss the swap by even one frame. It also covers
   * the page's FIRST load for free, which was a dark beat this screen always had.
   */
  const covered = cover != null && coverReadyKey !== currentKey;
  // A clip that never paints (broken, unreachable) must not leave the screen behind a still
  // forever — after the bail the page underneath shows its own honest error.
  const [bailed, setBailed] = useState(false);
  useEffect(() => {
    setBailed(false);
    if (!covered) return;
    const bail = setTimeout(() => setBailed(true), COVER_BAIL_MS);
    return () => clearTimeout(bail);
  }, [covered, currentKey]);
  const show = covered && !bailed;

  /** Mounted outlives `show` by the fade — appearing is INSTANT (it is hiding something),
   *  leaving is the only animated direction. */
  const [coverMounted, setCoverMounted] = useState(show);
  const coverFade = useRef(new Animated.Value(show ? 1 : 0)).current;
  useEffect(() => {
    if (show) {
      coverFade.setValue(1);
      setCoverMounted(true);
      return;
    }
    if (!coverMounted) return;
    const run = Animated.timing(coverFade, {
      toValue: 0,
      duration: COVER_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished) setCoverMounted(false);
    });
    return () => run.stop();
    // `coverMounted` is deliberately not a dependency: re-running the fade because the fade's own
    // completion changed it would restart a finished animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, coverFade]);

  /**
   * Everything the gesture reads lives in a ref: `PanResponder` is built once and its handlers
   * close over whatever was in scope then, so reading `width` or `onGo` directly would drag
   * against the first render's values — and `onGo` in particular changes identity every time the
   * current swing does, which is every time this fires.
   */
  const live = useRef({ width, hasPrev: false, hasNext: false, enabled, onGo });
  useEffect(() => {
    live.current = { width, hasPrev: prev != null, hasNext: next != null, enabled, onGo };
  });

  const settle = useCallback(() => {
    Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 0 }).start();
  }, [x]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Never on touch-down: the picture is the play/pause button and the scrub is a drag of
        // its own. This only asks once the finger has committed to travelling sideways.
        onMoveShouldSetPanResponder: (_e, g) => {
          const s = live.current;
          if (!s.enabled || committing.current) return false;
          if (Math.abs(g.dx) < CLAIM_PX) return false;
          if (Math.abs(g.dx) < Math.abs(g.dy) * HORIZONTAL_BIAS) return false;
          return g.dx > 0 ? s.hasPrev : s.hasNext;
        },
        onPanResponderMove: (_e, g) => {
          const s = live.current;
          // Dead at the ends rather than rubber-banding: there is nothing behind the edge to
          // uncover, and a page that moves off a black gap reads as a broken load.
          const open = g.dx > 0 ? s.hasPrev : s.hasNext;
          x.setValue(open ? Math.max(-s.width, Math.min(s.width, g.dx)) : 0);
        },
        onPanResponderRelease: (_e, g) => {
          const s = live.current;
          const step: -1 | 1 = g.dx < 0 ? 1 : -1;
          const open = step === 1 ? s.hasNext : s.hasPrev;
          const flicked = step === 1 ? g.vx < -COMMIT_VELOCITY : g.vx > COMMIT_VELOCITY;
          if (!open || (Math.abs(g.dx) < s.width * COMMIT_FRACTION && !flicked)) {
            settle();
            return;
          }
          Animated.timing(x, {
            toValue: step === 1 ? -s.width : s.width,
            duration: 190,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (!finished) return;
            // Left where it landed. The layout effect above recentres it in the same frame the
            // new page commits — see the note at the top of this file.
            committing.current = true;
            // The cover is derived from `currentKey` vs `coverReadyKey`, so the same commit that
            // swaps the page mounts it — nothing to call here.
            s.onGo(step);
          });
        },
        onPanResponderTerminate: settle,
      }),
    [settle, x],
  );

  /** Chrome dies over the first ~40% of a screen of travel — gone well before the commit. */
  const chrome = useMemo(
    () =>
      x.interpolate({
        inputRange: [-width * 0.4, 0, width * 0.4],
        outputRange: [0, 1, 0],
        extrapolate: "clamp",
      }),
    [width, x],
  );

  return (
    <View style={styles.fill}>
      <Animated.View style={[styles.fill, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
        <SwipeChromeContext.Provider value={chrome}>{children}</SwipeChromeContext.Provider>
        {prev != null ? (
          <View style={[styles.side, { width, left: -width }]} pointerEvents="none">
            {prev}
          </View>
        ) : null}
        {next != null ? (
          <View style={[styles.side, { width, right: -width }]} pointerEvents="none">
            {next}
          </View>
        ) : null}
      </Animated.View>

      {/* OUTSIDE the animated container on purpose: whatever the transform does for a frame, it
          cannot move this. */}
      {coverMounted && cover != null ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: coverFade }]}
        >
          {cover}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** The fade, once the player underneath has really painted — it lands on the playing video. */
const COVER_FADE_MS = 160;
/** A clip that never paints (broken, unreachable) releases the cover anyway. */
const COVER_BAIL_MS = 4000;

/* The doc note for the cover lives on `covered` above: derived, never imperative. */

const styles = StyleSheet.create({
  fill: { flex: 1 },
  side: { position: "absolute", top: 0, bottom: 0 },
});
