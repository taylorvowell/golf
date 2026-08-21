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

it("holds camera choices between recordings and stamps the view on the swing", () => {
  let s = sessionReducer(base(), { type: "set-view", view: "face_on" });
  s = sessionReducer(s, { type: "flip-camera" });
  // Zoom is clamped to the lens the preview actually opened — a ratio the camera cannot
  // reach would render a slider position the picture never matches.
  s = sessionReducer(s, { type: "set-zoom-range", range: { min: 1, max: 8 } });
  s = sessionReducer(s, { type: "set-zoom", zoom: 2 });
  expect([s.view, s.facing, s.zoom]).toEqual(["face_on", "front", 2]);
  expect(sessionReducer(s, { type: "set-zoom", zoom: 99 }).zoom).toBe(8);

  s = sessionReducer(s, { type: "arm" });
  // Mid-capture camera changes are ignored — they would change what the clip IS.
  expect(sessionReducer(s, { type: "set-view", view: "dtl" }).view).toBe("face_on");
  expect(sessionReducer(s, { type: "flip-camera" }).facing).toBe("front");

  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "stop", swingId: "a", at: 1 });
  expect(s.swings[0].view).toBe("face_on");
});

it("ignores arm while busy and countdown-done while not counting", () => {
  let s = sessionReducer(base(), { type: "arm" });
  expect(sessionReducer(s, { type: "arm" })).toBe(s);
  s = sessionReducer(s, { type: "countdown-done" });
  expect(sessionReducer(s, { type: "countdown-done" })).toBe(s);
});

it("shutter press arms from idle, cancels a countdown, and stops a recording", () => {
  let s = sessionReducer(base(), { type: "shutter-press", at: 0 });
  expect(s.mode).toBe("countdown");

  // A press mid-countdown cancels it — nothing minted, and no hold on trying again.
  s = sessionReducer(s, { type: "shutter-press", at: 1_000 });
  expect(s.mode).toBe("idle");
  expect(s.swings).toHaveLength(0);
  s = sessionReducer(s, { type: "shutter-press", at: 1_500 });
  expect(s.mode).toBe("countdown");

  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "shutter-press", at: 8_000 });
  expect(s.mode).toBe("idle");
  expect(s.swings).toHaveLength(1);
});

it("shutter press within 3s of a stop is the double click on Stop — ignored", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "stop", swingId: "a", at: 10_000 });
  expect(s.reviewing).toBe("a");

  expect(sessionReducer(s, { type: "shutter-press", at: 11_000 })).toBe(s);

  // Past the hold, a press on the post-swing screen starts the next swing.
  s = sessionReducer(s, { type: "shutter-press", at: 13_500 });
  expect(s.reviewing).toBeNull();
  expect(s.mode).toBe("countdown");
});
