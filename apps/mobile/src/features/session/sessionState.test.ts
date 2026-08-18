import {
  DEFAULT_SESSION_SETTINGS,
  initialSessionState,
  previousSwing,
  sessionDisplayName,
  sessionReducer,
  type SessionState,
} from "./sessionState";

/**
 * The rules that protect the golfer live in the reducer, so they are pinned here: the type
 * locks once a swing exists, an aborted countdown mints nothing, and a session's swings
 * only ever appear through a completed recording.
 */

const base = (): SessionState =>
  initialSessionState(3, new Date(2026, 7, 18), DEFAULT_SESSION_SETTINGS);

it("names the session from its number and date", () => {
  const s = base();
  expect(s.title).toBe("Session 3");
  expect(s.dateLabel).toBe("Aug 18");
  expect(sessionDisplayName(s)).toBe("Session 3 | Aug 18");
});

it("renames the title half only, and drops a whitespace rename", () => {
  const s = sessionReducer(base(), { type: "rename", title: "Morning grind" });
  expect(s.title).toBe("Morning grind");
  expect(s.dateLabel).toBe("Aug 18");
  expect(sessionReducer(s, { type: "rename", title: "   " }).title).toBe("Morning grind");
});

it("changes type while empty and locks it after the first swing", () => {
  let s = sessionReducer(base(), { type: "set-type", sessionType: "video_only" });
  expect(s.sessionType).toBe("video_only");

  s = sessionReducer(s, { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "stop", swingId: "a", at: 1 });
  expect(s.swings).toHaveLength(1);

  s = sessionReducer(s, { type: "set-type", sessionType: "swing_analysis" });
  expect(s.sessionType).toBe("video_only");
});

it("arms into a countdown, and straight into recording when the delay is off", () => {
  const withDelay = sessionReducer(base(), { type: "arm" });
  expect(withDelay.mode).toBe("countdown");

  let noDelay = sessionReducer(base(), { type: "set-settings", settings: { delaySeconds: 0 } });
  noDelay = sessionReducer(noDelay, { type: "arm" });
  expect(noDelay.mode).toBe("recording");
});

it("aborts a countdown to idle without minting a swing", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "stop" });
  expect(s.mode).toBe("idle");
  expect(s.swings).toHaveLength(0);
});

it("mints a numbered swing on stop, newest first, and marks it ready later", () => {
  let s = base();
  for (const id of ["a", "b"]) {
    s = sessionReducer(s, { type: "arm" });
    s = sessionReducer(s, { type: "countdown-done" });
    s = sessionReducer(s, { type: "stop", swingId: id, at: 1 });
  }
  expect(s.swings.map((sw) => sw.id)).toEqual(["b", "a"]);
  expect(s.swings.map((sw) => sw.number)).toEqual([2, 1]);
  expect(s.swings.every((sw) => sw.status === "analyzing")).toBe(true);

  s = sessionReducer(s, { type: "swing-ready", swingId: "a" });
  expect(s.swings.find((sw) => sw.id === "a")?.status).toBe("ready");
  expect(s.swings.find((sw) => sw.id === "b")?.status).toBe("analyzing");
});

it("reviews the new swing after stop, or stays on capture with replay off", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "stop", swingId: "a", at: 1 });
  expect(s.reviewing).toBe("a");

  s = sessionReducer(s, { type: "back-to-capture" });
  expect(s.reviewing).toBeNull();

  let off = sessionReducer(base(), { type: "set-settings", settings: { videoReplay: false } });
  off = sessionReducer(off, { type: "arm" });
  off = sessionReducer(off, { type: "countdown-done" });
  off = sessionReducer(off, { type: "stop", swingId: "b", at: 1 });
  expect(off.reviewing).toBeNull();
  expect(off.swings).toHaveLength(1);
});

it("mints video-only and AI-off swings born ready — nothing will ever analyze them", () => {
  let s = sessionReducer(base(), { type: "set-type", sessionType: "video_only" });
  s = sessionReducer(s, { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "stop", swingId: "a", at: 1 });
  expect(s.swings[0].status).toBe("ready");
});

it("navigates between session swings and deletes back to capture", () => {
  let s = base();
  for (const id of ["a", "b"]) {
    s = sessionReducer(s, { type: "arm" });
    s = sessionReducer(s, { type: "countdown-done" });
    s = sessionReducer(s, { type: "stop", swingId: id, at: 1 });
  }
  expect(s.reviewing).toBe("b");
  expect(previousSwing(s, "b")?.id).toBe("a");
  expect(previousSwing(s, "a")).toBeNull();

  s = sessionReducer(s, { type: "review", swingId: "a" });
  expect(s.reviewing).toBe("a");
  expect(sessionReducer(s, { type: "review", swingId: "ghost" }).reviewing).toBe("a");

  s = sessionReducer(s, { type: "delete-swing", swingId: "a" });
  expect(s.reviewing).toBeNull();
  expect(s.swings.map((sw) => sw.id)).toEqual(["b"]);
});

it("ignores arm while busy and countdown-done while not counting", () => {
  let s = sessionReducer(base(), { type: "arm" });
  expect(sessionReducer(s, { type: "arm" })).toBe(s);
  s = sessionReducer(s, { type: "countdown-done" });
  expect(sessionReducer(s, { type: "countdown-done" })).toBe(s);
});
