import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, useWindowDimensions } from "react-native";

/**
 * How screens hide the navigation chrome — and the ONLY way they may. The amended rule
 * (Taylor 2026-08-14): chrome may hide solely as a deterministic function of scroll position,
 * because scroll is under the golfer's finger and fully reversible by the same gesture.
 * Never tap-to-hide, never a timer. A screen publishes its scroll state; the app header and
 * the tab bar subscribe and slide. Default visible — a screen that says nothing hides nothing.
 *
 * **The two bars move on different models** (Taylor, 2026-08-18).
 *
 *   * The TAB BAR latches: `hidden` flips once a run is long enough to read as intent, then it
 *     animates. It is a tap target, and one that flickers under the thumb is worse than one
 *     that lags.
 *   * The TOP BAR gets the raw scroll offset in `chromePx` and does the rest itself — it is the
 *     only consumer that needs its own height to decide anything, so that logic lives with it
 *     rather than here. See `AppHeader`.
 *
 * `chromePx` is returned by `useChromeScroll` and is therefore **per screen**, not shared. It has
 * to be: every screen keeps its own scroll position, so a shared offset holds whatever screen
 * moved last, and coming back to a screen left scrolled drew its header over its own content
 * (Taylor, 2026-08-18). `hidden` stays global — the tab bar is one bar for the whole shell.
 *
 * `useChromeScroll` is the one sanctioned driver (Taylor 2026-08-17): scrolling DOWN hides
 * both bars, any scroll UP brings them back, and the top of a screen always shows them. The
 * flag is global on purpose — the tab bar is only tappable while visible, so the screen a
 * tab switch lands on inherits a visible bar by construction.
 */
const NavVisibilityContext = createContext<{
  /** The TAB BAR's flag — run-gated, then animated. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}>({ hidden: false, setHidden: () => {} });

export function NavVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const value = useMemo(() => ({ hidden, setHidden }), [hidden]);
  return createElement(NavVisibilityContext.Provider, { value }, children);
}

export function useNavVisibility() {
  return useContext(NavVisibilityContext);
}

/** At or above this offset the chrome always shows — a settled top never hides the bars. */
export const CHROME_TOP = 8;
/**
 * How far a run in one direction must travel before it flips visibility, as a fraction of
 * the window height (Taylor 2026-08-17: a minimum of 15%, so an incidental micro-drag never
 * reads as intent). The run resets on every reversal, so jitter never strobes the chrome.
 */
export const CHROME_RUN_FRACTION = 0.15;

export interface ChromeScroll {
  /** Last seen offset (clamped to 0 — bounce is not a direction). */
  y: number;
  /** Where the current direction's run began — the last reversal point. */
  anchor: number;
  hidden: boolean;
}

/** Pure step so the direction rules are testable without a scroll view. `run` is the px a
 *  single-direction drag must cover to flip visibility (15% of the window in production). */
export function chromeScrollStep(s: ChromeScroll, rawY: number, run: number): ChromeScroll {
  const y = Math.max(0, rawY);
  if (y === s.y) return s;
  const down = y > s.y;
  // A reversal moves the anchor to the extremum the finger just turned at.
  const anchor = (down ? s.y < s.anchor : s.y > s.anchor) ? s.y : s.anchor;
  let hidden = s.hidden;
  if (y <= CHROME_TOP) hidden = false;
  else if (down && !hidden && y - anchor >= run) hidden = true;
  else if (!down && hidden && anchor - y >= run) hidden = false;
  return { y, anchor, hidden };
}

/**
 * Should the TOP BAR be latched out, given where the scroll is and where it came from?
 *
 * Pure, and separated from `AppHeader` for the same reason `chromeScrollStep` is separated from
 * the scroll view: these three rules are the subtlest thing in the chrome — they were arrived at
 * by a long round of tuning — and inline in an `addListener` callback they could only be checked
 * by scrolling a phone.
 *
 * `slideAfter` and `barHeight` are the bar's own geometry, which is why the caller owns them.
 * The thresholds are deliberately ASYMMETRIC: out once a departure passes the buffer, back only
 * while returning AND already within a bar-height of the top — that last stretch is what the
 * content-coupled floor carries, which is what makes the return sticky instead of a second
 * animation.
 */
export function headerLatchStep(
  latched: boolean,
  y: number,
  previousY: number,
  { slideAfter, barHeight }: { slideAfter: number; barHeight: number },
): boolean {
  // At the top the bar is always in, whatever the direction was. Not merely the resting case:
  // on a screen change the offset can jump to a value the direction test cannot interpret, and
  // without an absolute floor the latch would keep a stale answer.
  if (y <= CHROME_TOP) return false;
  const up = y < previousY;
  if (!up && y > slideAfter) return true;
  if (up && y < barHeight) return false;
  return latched;
}

/**
 * The screen-side half: feed `onScroll` the scroll offset, and hand `chromePx` to this screen's
 * `AppHeader`. Ref-held state, setState only on flips — nothing re-renders mid-scroll.
 */
export function useChromeScroll(): {
  onScroll: (y: number) => void;
  chromePx: Animated.Value;
} {
  const { setHidden } = useNavVisibility();
  // Per screen, deliberately — see the note at the top of this file.
  const chromePx = useRef(new Animated.Value(0)).current;
  const { height } = useWindowDimensions();
  const run = height * CHROME_RUN_FRACTION;
  const scroll = useRef<ChromeScroll>({ y: 0, anchor: 0, hidden: false });
  // Mirrored, because an Animated.Value cannot be read back synchronously.
  const px = useRef(0);

  const onScroll = useCallback(
    (rawY: number) => {
      const prev = scroll.current;
      const next = chromeScrollStep(prev, rawY, run);
      scroll.current = next;
      if (next.hidden !== prev.hidden) setHidden(next.hidden);

      // The header's channel: the scroll offset itself, ABSOLUTE rather than accumulated,
      // so it only unwinds by scrolling back toward the top.
      if (next.y !== px.current) {
        px.current = next.y;
        chromePx.setValue(next.y);
      }
    },
    [setHidden, run, chromePx],
  );

  return useMemo(() => ({ onScroll, chromePx }), [onScroll, chromePx]);
}
