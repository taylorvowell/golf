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
import { useWindowDimensions } from "react-native";

/**
 * How screens hide the navigation chrome — and the ONLY way they may. The amended rule
 * (Taylor 2026-08-14): chrome may hide solely as a deterministic function of scroll position,
 * because scroll is under the golfer's finger and fully reversible by the same gesture.
 * Never tap-to-hide, never a timer. A screen publishes `hidden` from its scroll state; the
 * app header and the tab bar subscribe and slide. Default visible — a screen that says
 * nothing hides nothing.
 *
 * `useChromeScroll` is the one sanctioned driver (Taylor 2026-08-17): scrolling DOWN hides
 * both bars, any scroll UP brings them back, and the top of a screen always shows them. The
 * flag is global on purpose — the tab bar is only tappable while visible, so the screen a
 * tab switch lands on inherits a visible bar by construction.
 */
const NavVisibilityContext = createContext<{
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
 * The screen-side half: feed it the scroll offset, it drives the shared `hidden` flag.
 * Ref-held state, setState only on flips — nothing re-renders mid-scroll.
 */
export function useChromeScroll(): (y: number) => void {
  const { setHidden } = useNavVisibility();
  const { height } = useWindowDimensions();
  const run = height * CHROME_RUN_FRACTION;
  const scroll = useRef<ChromeScroll>({ y: 0, anchor: 0, hidden: false });

  return useCallback(
    (rawY: number) => {
      const prev = scroll.current;
      const next = chromeScrollStep(prev, rawY, run);
      scroll.current = next;
      if (next.hidden !== prev.hidden) setHidden(next.hidden);
    },
    [setHidden, run],
  );
}
