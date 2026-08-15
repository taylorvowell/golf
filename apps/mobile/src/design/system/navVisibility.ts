import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * How screens hide the navigation chrome — and the ONLY way they may. The amended rule
 * (Taylor 2026-08-14): chrome may hide solely as a deterministic function of scroll position,
 * because scroll is under the golfer's finger and fully reversible by the same gesture.
 * Never tap-to-hide, never a timer. A screen publishes `hidden` from its scroll state; the
 * tab bar subscribes and slides. Default visible — a screen that says nothing hides nothing.
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
