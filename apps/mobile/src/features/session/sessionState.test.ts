import {
  DEFAULT_SESSION_SETTINGS,
  initialSessionState,
  previousSwing,
  sessionReducer,
  type SessionState,
  type SwingClipRef,
} from "./sessionState";

/**
 * The rules that protect the golfer live in the reducer, so they are pinned here: the type
 * locks once a swing exists, an aborted countdown mints nothing, a recording only becomes a
 * swing through review (take-ready → save-take, capture spec §01.5), and an unreviewed take
 * — the only copy of that swing — can never be recorded over or destroyed by a stray press.
 */

const base = (): SessionState =>
  initialSessionState(3, new Date(2026, 7, 18), DEFAULT_SESSION_SETTINGS);

const TAKE: SwingClipRef = { path: "/cache/take.mp4", fps: 240, durationMs: 20_000 };
const CLIP: SwingClipRef = { path: "/cache/clip.mp4", fps: 240, durationMs: 6_000 };

/** The full happy path: arm → countdown → recording → finalized take → reviewed → saved. */
function recordSwing(s: SessionState, id: string, at = 1): SessionState {
  s = sessionReducer(s, { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "take-ready", take: TAKE, at });
  s = sessionReducer(s, { type: "save-take", swingId: id, clip: CLIP, at });
  return s;
}

it("names the session from its number", () => {
  const s = base();
  expect(s.title).toBe("Session 3");
});

it("renames, and drops a whitespace rename", () => {
  const s = sessionReducer(base(), { type: "rename", title: "Morning grind" });
  expect(s.title).toBe("Morning grind");
  expect(sessionReducer(s, { type: "rename", title: "   " }).title).toBe("Morning grind");
});

it("changes type while empty and locks it after the first swing", () => {
  let s = sessionReducer(base(), { type: "set-type", sessionType: "video_only" });
  expect(s.sessionType).toBe("video_only");

  s = recordSwing(s, "a");
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

it("a finalized take opens review; only save-take mints the swing", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "take-ready", take: TAKE, at: 10 });
  expect(s.mode).toBe("idle");
  expect(s.pendingTake).toMatchObject(TAKE);
  expect(s.swings).toHaveLength(0);
  expect(s.stoppedAt).toBe(10);

  s = sessionReducer(s, { type: "save-take", swingId: "a", clip: CLIP, at: 12 });
  expect(s.pendingTake).toBeNull();
  expect(s.swings).toHaveLength(1);
  expect(s.swings[0]).toMatchObject({ id: "a", number: 1, clip: CLIP });
});

it("take-ready is idempotent against the tap/hard-cap race", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "take-ready", take: TAKE, at: 10 });
  // The loser of the race answers late — it must not re-open review or move anything.
  expect(sessionReducer(s, { type: "take-ready", take: CLIP, at: 11 })).toBe(s);
});

it("a dev clip opens review flagged, and never lands over a live or unreviewed take", () => {
  // Flagged is the whole point: SessionScreen reads `dev` to decide whether Save and Delete
  // may unlink the file, and an unflagged dev take deletes a developer's own clip library.
  const injected = sessionReducer(base(), { type: "dev-take", take: TAKE, at: 5 });
  expect(injected.pendingTake).toMatchObject({ path: TAKE.path, dev: true });

  // The clip's own angle wins over the screen's, and the screen follows it. Stamping a
  // front-view clip `dtl` inverts every lead/trail metric downstream, where it reads as bad
  // analysis rather than bad metadata — so it is pinned here.
  const front = sessionReducer(base(), { type: "dev-take", take: TAKE, view: "face_on" });
  expect(front.pendingTake?.view).toBe("face_on");
  expect(front.view).toBe("face_on");

  // Mid-take it is refused — the camera owns the surface and the real file is still being
  // written; and over an unreviewed take it would drop that take's only copy on the floor.
  let recording = sessionReducer(base(), { type: "arm" });
  recording = sessionReducer(recording, { type: "countdown-done" });
  expect(sessionReducer(recording, { type: "dev-take", take: CLIP })).toBe(recording);
  const unreviewed = sessionReducer(recording, { type: "take-ready", take: TAKE, at: 10 });
  expect(sessionReducer(unreviewed, { type: "dev-take", take: CLIP })).toBe(unreviewed);
});

it("nothing arms over an unreviewed take, and discard mints nothing", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "take-ready", take: TAKE, at: 10 });

  // The take is the only copy of that swing — arm and the remote are both sealed.
  expect(sessionReducer(s, { type: "arm" })).toBe(s);
  expect(sessionReducer(s, { type: "shutter-press", at: 99_000 })).toBe(s);

  s = sessionReducer(s, { type: "discard-take" });
  expect(s.pendingTake).toBeNull();
  expect(s.swings).toHaveLength(0);
  expect(s.mode).toBe("idle");
});

it("a countdown stopped MID-SESSION returns to the swing you came from", () => {
  // The "a session is a LOOP" rule (Taylor): stopping a countdown must not drop the golfer
  // on the empty capture screen when there is a swing behind them. Only the empty-session
  // case was pinned before, which is the branch that does NOT exercise the rule.
  let s = recordSwing(base(), "a");
  s = sessionReducer(s, { type: "back-to-capture" });
  s = sessionReducer(s, { type: "arm" });
  expect(s.mode).toBe("countdown");

  s = sessionReducer(s, { type: "stop" });
  expect(s.mode).toBe("idle");
  expect(s.reviewing).toBe("a");
  expect(s.swings).toHaveLength(1);
});

it("an untouched zoom re-defaults to the new lens; a chosen one is kept and clamped", () => {
  // The trickiest expression in the reducer and it was never exercised: the real range only
  // arrives once the preview opens, so Front view's "widest" is unknowable before that.
  let s = sessionReducer(base(), { type: "set-view", view: "face_on" });
  s = sessionReducer(s, { type: "set-zoom-range", range: { min: 0.5, max: 8 } });
  // Untouched → face_on's default is the lens's WIDEST.
  expect(s.zoom).toBe(0.5);

  s = sessionReducer(s, { type: "set-zoom", zoom: 4 });
  s = sessionReducer(s, { type: "set-zoom-range", range: { min: 1, max: 2 } });
  // Deliberately chosen → kept, but clamped into what the new lens can reach.
  expect(s.zoom).toBe(2);
});

it("save-take with no pending take changes nothing", () => {
  const s = base();
  expect(sessionReducer(s, { type: "save-take", clip: CLIP, at: 1 })).toBe(s);
});

it("record-failed off `recording` changes nothing — the guard the tap/cap race rests on", () => {
  const s = recordSwing(base(), "a");
  expect(sessionReducer(s, { type: "record-failed" })).toBe(s);
});

it("record-failed returns to idle with nothing minted", () => {
  let s = sessionReducer(base(), { type: "set-settings", settings: { delaySeconds: 0 } });
  s = sessionReducer(s, { type: "arm" });
  expect(s.mode).toBe("recording");
  s = sessionReducer(s, { type: "record-failed" });
  expect(s.mode).toBe("idle");
  expect(s.pendingTake).toBeNull();
  expect(s.swings).toHaveLength(0);
});

it("numbers swings in hit order, newest first, and marks them ready later", () => {
  let s = base();
  for (const id of ["a", "b"]) s = recordSwing(s, id);
  expect(s.swings.map((sw) => sw.id)).toEqual(["b", "a"]);
  expect(s.swings.map((sw) => sw.number)).toEqual([2, 1]);
  expect(s.swings.every((sw) => sw.status === "analyzing")).toBe(true);

  s = sessionReducer(s, { type: "swing-ready", swingId: "a" });
  expect(s.swings.find((sw) => sw.id === "a")?.status).toBe("ready");
  expect(s.swings.find((sw) => sw.id === "b")?.status).toBe("analyzing");
});

it("reviews the new swing after save, or stays on capture with replay off", () => {
  const s = recordSwing(base(), "a");
  expect(s.reviewing).toBe("a");
  expect(sessionReducer(s, { type: "back-to-capture" }).reviewing).toBeNull();

  let off = sessionReducer(base(), { type: "set-settings", settings: { videoReplay: false } });
  off = recordSwing(off, "b");
  expect(off.reviewing).toBeNull();
  expect(off.swings).toHaveLength(1);
});

it("mints video-only and AI-off swings born ready — nothing will ever analyze them", () => {
  let s = sessionReducer(base(), { type: "set-type", sessionType: "video_only" });
  s = recordSwing(s, "a");
  expect(s.swings[0].status).toBe("ready");
});

it("navigates between session swings and deletes back to capture", () => {
  let s = base();
  for (const id of ["a", "b"]) s = recordSwing(s, id);
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
  // Zoom is clamped to the lens the preview actually opened — a ratio the camera cannot
  // reach would render a slider position the picture never matches.
  s = sessionReducer(s, { type: "set-zoom-range", range: { min: 1, max: 8 } });
  s = sessionReducer(s, { type: "set-zoom", zoom: 2 });
  expect([s.view, s.zoom]).toEqual(["face_on", 2]);
  expect(sessionReducer(s, { type: "set-zoom", zoom: 99 }).zoom).toBe(8);

  s = sessionReducer(s, { type: "arm" });
  // Mid-capture camera changes are ignored — they would change what the clip IS.
  expect(sessionReducer(s, { type: "set-view", view: "dtl" }).view).toBe("face_on");
  expect(sessionReducer(s, { type: "set-zoom", zoom: 4 }).zoom).toBe(2);

  s = sessionReducer(s, { type: "countdown-done" });
  // The view is stamped when the take finalizes, and it survives through the save.
  s = sessionReducer(s, { type: "take-ready", take: TAKE, at: 1 });
  expect(s.pendingTake?.view).toBe("face_on");
  s = sessionReducer(s, { type: "save-take", swingId: "a", clip: CLIP, at: 2 });
  expect(s.swings[0].view).toBe("face_on");
});

it("ignores arm while busy and countdown-done while not counting", () => {
  let s = sessionReducer(base(), { type: "arm" });
  expect(sessionReducer(s, { type: "arm" })).toBe(s);
  s = sessionReducer(s, { type: "countdown-done" });
  expect(sessionReducer(s, { type: "countdown-done" })).toBe(s);
});

it("shutter press arms from idle and cancels a countdown — but never stops a recording", () => {
  let s = sessionReducer(base(), { type: "shutter-press", at: 0 });
  expect(s.mode).toBe("countdown");

  // A press mid-countdown cancels it — nothing minted, and no hold on trying again.
  s = sessionReducer(s, { type: "shutter-press", at: 1_000 });
  expect(s.mode).toBe("idle");
  expect(s.swings).toHaveLength(0);
  s = sessionReducer(s, { type: "shutter-press", at: 1_500 });
  expect(s.mode).toBe("countdown");

  s = sessionReducer(s, { type: "countdown-done" });
  // Ending a recording is the native recorder's to do — the screen routes that press to
  // `stopRecording()` and the reducer waits for `take-ready`. A press here changes nothing.
  expect(sessionReducer(s, { type: "shutter-press", at: 8_000 })).toBe(s);
});

it("the REMOTE arms from the after-swing screen and from capture — the tripod loop", () => {
  // The on-screen "Record New Swing" only navigates (SessionScreen), because a thumb on the
  // screen means the phone is in hand. A remote press means the golfer is at the ball, so it
  // must start the swing outright or the remote is pointless. Pinning the divergence.
  let s = recordSwing(base(), "a", 0);
  expect(s.reviewing).toBe("a");

  s = sessionReducer(s, { type: "shutter-press", at: 20_000 });
  expect(s.reviewing).toBeNull();
  expect(s.mode).toBe("countdown");

  // And again from the capture screen itself, mid-session.
  s = sessionReducer(s, { type: "disarm" });
  expect(s.mode).toBe("idle");
  s = sessionReducer(s, { type: "shutter-press", at: 21_000 });
  expect(s.mode).toBe("countdown");
});

it("shutter press within 3s of a stop is the double click on Stop — ignored", () => {
  let s = sessionReducer(base(), { type: "arm" });
  s = sessionReducer(s, { type: "countdown-done" });
  s = sessionReducer(s, { type: "take-ready", take: TAKE, at: 10_000 });
  s = sessionReducer(s, { type: "save-take", swingId: "a", clip: CLIP, at: 10_500 });
  expect(s.reviewing).toBe("a");

  expect(sessionReducer(s, { type: "shutter-press", at: 11_000 })).toBe(s);

  // Past the hold, a press on the post-swing screen starts the next swing.
  s = sessionReducer(s, { type: "shutter-press", at: 13_500 });
  expect(s.reviewing).toBeNull();
  expect(s.mode).toBe("countdown");
});
