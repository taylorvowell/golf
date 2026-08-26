import type { AppMode } from "./appMode";

/**
 * THE MODE-AWARE DEEP-LINK SEAM (architecture §7a) — a named stub, deliberately.
 *
 * A tap on "student requested a review" must land in INSTRUCTOR mode; "your instructor sent a
 * lesson" in PERSONAL. When the notifications track wires push taps to navigation, it routes
 * through this function — switch mode first (`setAppMode`), then navigate — instead of
 * inventing per-notification mode logic at N call sites.
 *
 * Instructor-side kinds per §29's coach family; everything else is the golfer's.
 */
const INSTRUCTOR_MODE_KINDS: ReadonlySet<string> = new Set([
  "golfer_request",
  "golfer_swing",
  "golfer_reply",
  "plan_progress",
  "review_requested",
  "student_message",
  "lesson_viewed",
  "drill_done",
  "student_goal_achieved",
]);

export function modeForNotification(kind: string): AppMode {
  return INSTRUCTOR_MODE_KINDS.has(kind) ? "instructor" : "personal";
}
