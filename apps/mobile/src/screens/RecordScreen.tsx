import { SessionScreen } from "../features/session/SessionScreen";

/**
 * Record — the capture surface. The tab bar's Record door opens session mode (D61): the
 * live capture screen with the session's name, type and settings over the picture. The
 * placeholder filming checklist this screen used to hold lives on, as the session help
 * sheet's content.
 *
 * A thin host on purpose: the route stays `Record` (App.tsx wraps it in `FixedDarkTheme`),
 * and everything real lives in `features/session/`.
 */
export function RecordScreen() {
  return <SessionScreen />;
}
