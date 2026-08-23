import type { Notification } from "@swingsage/schema/contract";

import { foldLabel, NOTIFICATION_LOOK, relativeAge } from "./notificationCopy";

/**
 * The inbox's presentation layer, tested directly because none of it is visible in a screenshot
 * review: an age that says "yesterday" at four hours, a fold that reads "1 messages", or a kind
 * added to the taxonomy that renders with no glyph all look like a working screen.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The taxonomy as the contract declares it — mirrored so a kind added to the enum without an
 *  entry in the look map fails HERE as well as at the type level. */
const ALL_KINDS: Notification["kind"][] = [
  "analysis_ready",
  "analysis_failed",
  "coach_request_approved",
  "coach_request_declined",
  "swing_reviewed",
  "coach_comment",
  "coach_annotation",
  "coach_message",
  "coach_plan",
  "subscription_event",
  "goal_assigned",
  "goal_achieved",
  "goal_regressed",
  "lesson_sent",
  "conversation_reply",
  "review_answered",
  "achievement_earned",
  "golfer_request",
  "golfer_swing",
  "golfer_reply",
  "plan_progress",
  "review_requested",
  "student_message",
  "lesson_viewed",
  "drill_done",
  "student_goal_achieved",
];

describe("NOTIFICATION_LOOK", () => {
  it("covers every kind in the taxonomy — a row with no glyph is an invisible failure", () => {
    for (const kind of ALL_KINDS) {
      expect(NOTIFICATION_LOOK[kind]).toBeDefined();
      expect(NOTIFICATION_LOOK[kind].icon).toBeTruthy();
    }
  });

  it("has no entries the taxonomy does not declare", () => {
    expect(Object.keys(NOTIFICATION_LOOK).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("keeps a refusal and an arrival visually distinct", () => {
    expect(NOTIFICATION_LOOK.coach_request_declined.tone).toBe("bad");
    expect(NOTIFICATION_LOOK.coach_request_approved.tone).toBe("good");
    expect(NOTIFICATION_LOOK.goal_regressed.tone).toBe("bad");
  });
});

describe("relativeAge", () => {
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);

  it.each([
    [0, "just now"],
    [MINUTE - 1, "just now"],
    [MINUTE, "1m"],
    [59 * MINUTE, "59m"],
    [HOUR, "1h"],
    [23 * HOUR, "23h"],
    [DAY, "yesterday"],
    [2 * DAY - 1, "yesterday"],
    [2 * DAY, "2d"],
    [6 * DAY, "6d"],
  ])("reads %ims ago as %s", (delta, expected) => {
    expect(relativeAge(now - delta, now)).toBe(expected);
  });

  it("falls back to a date past a week, where an exact age stops meaning anything", () => {
    // Local-time construction: the formatter reads the phone's calendar, so the fixture must too.
    const created = new Date(2026, 6, 4, 9, 30).getTime();
    expect(relativeAge(created, created + 20 * DAY)).toBe("4 Jul");
  });

  it("says 'just now' for a row minted marginally in the future — phone/server clock skew", () => {
    expect(relativeAge(now + 4_000, now)).toBe("just now");
  });
});

describe("foldLabel", () => {
  it("stays silent on an ungrouped row — '1 message' is a line that adds nothing", () => {
    expect(foldLabel("coach_message", 1)).toBeNull();
    expect(foldLabel("coach_message", 0)).toBeNull();
  });

  it("names what the fold contains", () => {
    expect(foldLabel("coach_message", 3)).toBe("3 messages");
    expect(foldLabel("conversation_reply", 2)).toBe("2 replies");
    expect(foldLabel("analysis_ready", 4)).toBe("4 swings analysed");
  });

  it("falls back to a truthful noun for a kind with no phrasing of its own", () => {
    expect(foldLabel("subscription_event", 2)).toBe("2 updates");
  });
});
