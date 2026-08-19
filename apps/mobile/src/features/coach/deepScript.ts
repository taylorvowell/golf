import type { Analysis } from "@swingsage/schema/contract";

import type { StanceAnnotation } from "../../design/system";
import { anchorsAt } from "./stanceAnchors";

/**
 * The DEEP SWING ANALYSIS program (Taylor, 2026-08-19): the swing VIDEO plays, auto-pauses at
 * named positions, the coach annotates the paused frame (draw → talk → clear), then playback
 * rolls to the next moment. The golfer never drives the video — they drive the ANALYSIS
 * (pause it, step back a moment, scrub across moments), and the video follows.
 *
 * Each moment pauses at one of the artifact's own P1–P10 checkpoints, so "the top" is the
 * analyzer's top, not a guessed timestamp — and the marks come from the golfer's own
 * keypoints/club at that exact frame (`anchorsAt`), the same personalization contract as the
 * stance walkthrough.
 *
 * STUB, flagged: narration is the voice script as text. Verdicts follow the stance walk's
 * honesty rule — only a moment with a REAL geometric check carries one (today: the
 * hands-at-bicep alignment; the rest observe without judging until they earn a check). An AI
 * read of the paused frame may later feed the free-observation lines; the geometry never
 * comes from AI.
 */

export interface DeepMoment {
  key: string;
  /** The artifact checkpoint this moment pauses on… */
  pauseAt?: string;
  /** …or a computed frame for moments the P-system doesn't name (the hands-at-bicep
   *  crossing). Null when the artifact can't answer — the moment drops out. */
  resolveFrame?: (a: Analysis) => number | null;
  eyebrow: string;
  title: string;
  narration: string;
  /** The adjust-path narration when the moment's check fails. */
  alt?: string;
  /** The paused frame's marks + the check's verdict (null when the moment carries no real
   *  geometric check — same honesty rule as the stance walk). `say` overrides the narration
   *  when a moment carries MORE THAN ONE check and the fail must name the right fault. */
  marks: (
    a: Analysis,
    frame: number,
  ) => { marks: StanceAnnotation[]; verdict: "pass" | "fail" | null; say?: string };
  /** How long the annotated hold lasts after the draw. */
  holdMs: number;
}

/** How far (horizontally) the hands may sit from the bicep line and still pass, as a
 *  fraction of the trail upper-arm's length. Far past it reads as the hands extending too
 *  far backward. Stub-tuned at the sign-off walk. */
const HANDS_BICEP_TOLERANCE = 0.6;

/** Keypoint by name at (or nearest) a frame, conf-gated — local twin of `anchorsAt`'s rule
 *  for the per-frame scan below, where building full anchors per frame would be waste. */
function kpAt(
  a: Analysis,
  fr: { kp: ReadonlyArray<readonly number[]> },
  idx: Map<string, number>,
  name: string,
): [number, number] | null {
  const i = idx.get(name);
  if (i === undefined) return null;
  const entry = fr.kp[i];
  if (!entry || entry[2] < 0.35) return null;
  return [entry[0], entry[1]];
}

/**
 * The frame where the hands first rise past the height of the trail bicep (the midpoint of
 * the trail upper arm) during the backswing — scanned between P2 and P4 on the golfer's own
 * pose track. The bicep level moves as the golfer turns, so it is re-evaluated per frame.
 */
function handsAtBicepFrame(a: Analysis): number | null {
  const cps = a.checkpoints;
  if (!cps) return null;
  const p2 = cps.find((c) => c.p === "P2")?.frame;
  const p4 = cps.find((c) => c.p === "P4")?.frame;
  if (p2 === undefined || p4 === undefined || p4 <= p2) return null;
  const trail = a.video.handedness === "left" ? "left" : "right";
  const idx = new Map<string, number>();
  a.pose.keypoint_names.forEach((n, i) => idx.set(n, i));
  for (const fr of a.pose.frames) {
    if (fr.f <= p2 || fr.f > p4) continue;
    const wl = kpAt(a, fr, idx, "left_wrist");
    const wr = kpAt(a, fr, idx, "right_wrist");
    const sh = kpAt(a, fr, idx, `${trail}_shoulder`);
    const el = kpAt(a, fr, idx, `${trail}_elbow`);
    if (!wl || !wr || !sh || !el) continue;
    const wristY = (wl[1] + wr[1]) / 2;
    const bicepY = (sh[1] + el[1]) / 2;
    // y is down: the hands have risen PAST the bicep line when their y goes above it.
    if (wristY <= bicepY) return fr.f;
  }
  return null;
}

/** How tilted the trail foot must be at the finish to count as up on its toe — heel rise
 *  over foot length (0.4 ≈ 24°). Below it the foot reads as planted. Stub-tuned. */
const FINISH_FOOT_LIFT = 0.4;

/** How much the LEAD elbow may bend at the top and still read as a straight lead arm,
 *  degrees from straight. ≈25° is where coaches start calling it a collapse. Stub-tuned. */
const ARM_BEND_MAX_DEG = 25;

/** How far from FLAT (horizontal) the hip/shoulder rods may sit at the finish and still
 *  read as fully rotated to the target — "at least flat, if not rotated more". Stub-tuned. */
const FINISH_ROT_FLAT_DEG = 18;

/** Hips must beat shoulders by at least this ratio to pass mid-downswing — at 1.0 a tie
 *  fails, because "hips at the same speed" is the fault the check exists to catch. */
const SEPARATION_RATIO = 1.0;

/**
 * Mean angular speed (radians/frame, pixel space) of the left↔right line through a joint
 * pair, over a window around `frame`. Null when fewer than three conf-gated samples exist —
 * a rate from two frames is noise wearing a number.
 */
function lineRate(
  a: Analysis,
  frame: number,
  left: string,
  right: string,
  window = 5,
): number | null {
  const idx = new Map<string, number>();
  a.pose.keypoint_names.forEach((n, i) => idx.set(n, i));
  const W = a.video.width;
  const H = a.video.height;
  const angles: Array<{ f: number; angle: number }> = [];
  for (const fr of a.pose.frames) {
    if (Math.abs(fr.f - frame) > window) continue;
    const l = kpAt(a, fr, idx, left);
    const r = kpAt(a, fr, idx, right);
    if (!l || !r) continue;
    angles.push({ f: fr.f, angle: Math.atan2((r[1] - l[1]) * H, (r[0] - l[0]) * W) });
  }
  if (angles.length < 3) return null;
  angles.sort((x, y) => x.f - y.f);
  let sum = 0;
  let n = 0;
  for (let i = 1; i < angles.length; i++) {
    const df = angles[i].f - angles[i - 1].f;
    if (df <= 0) continue;
    let da = angles[i].angle - angles[i - 1].angle;
    // Unwrap across ±π so a line crossing the axis doesn't read as a huge swing.
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    sum += Math.abs(da) / df;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

/** How much steeper (radians) the downswing line may sit above the backswing line before it
 *  reads as over the top — ~3°. Below-or-equal is the pass; the tolerance absorbs head
 *  detection jitter, not the fault. */
const PLANE_TOLERANCE_RAD = 0.05;

export interface SwingPlane {
  /** The fast back-and-forth loop's frame range (takeaway → impact). */
  loop: [number, number];
  /** Where the video pauses for the lines — the top, where both planes read at once. */
  holdFrame: number;
  marks: StanceAnnotation[];
  verdict: "pass" | "fail";
}

/**
 * THE PLANE OF TRAVEL (Taylor, 2026-08-19 — "this is very important"): both planes anchored
 * at the BALL, each through the club head — halfway up the backswing, halfway down the
 * downswing. The downswing line belongs BELOW the backswing line; above it is the
 * over-the-top move. Halfway is frame-midway between the artifact's own checkpoints
 * (P1→P4 up, P4→P7 down), and each head is the nearest real club detection within eight
 * frames of that midpoint — no head, no plane, no verdict (null return; the phase skips).
 */
export function computeSwingPlane(a: Analysis): SwingPlane | null {
  const cp = (code: string) => a.checkpoints?.find((c) => c.p === code)?.frame;
  const p1 = cp("P1");
  const p4 = cp("P4");
  const p7 = cp("P7");
  if (p1 === undefined || p4 === undefined || p7 === undefined) return null;
  if (!a.club) return null;

  const W = a.video.width;
  const H = a.video.height;

  // Taylor's construction (2026-08-19): the line runs from the BALL (the club head's start)
  // to the club head AT WAIST HEIGHT. When no detection lands exactly on the waist level,
  // the two frames straddling it are split down the middle. One line per phase; the
  // downswing's belongs at-or-below the backswing's.
  const address = anchorsAt(a, p1, true);
  const ball: [number, number] | null = a.club.ball
    ? [a.club.ball.x, a.club.ball.y]
    : (address.shaft?.head ?? null);
  const waistY = address.waist?.[1] ?? address.hipMid?.[1] ?? null;
  if (!ball || waistY === null) return null;

  // The path samples come from the TRACE — the analyzer's curated, outlier-filtered club
  // path (the very line the player draws), NOT raw per-frame detections, whose stray heads
  // are what kept throwing this line around. The waist crossing walks the trace in path
  // order and splits the straddling pair down the middle (Taylor's construction).
  const trace = a.club.trace;
  const waistPoint = (pts: ReadonlyArray<readonly number[]>): [number, number] | null => {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const prevBelow = prev[1] > waistY;
      const currBelow = curr[1] > waistY;
      if (prevBelow !== currBelow) {
        return [(prev[0] + curr[0]) / 2, (prev[1] + curr[1]) / 2];
      }
    }
    // No crossing pair (a gapped trace) — the point closest to waist level stands in.
    let best: { d: number; pt: [number, number] } | null = null;
    for (const pt of pts) {
      const d = Math.abs(pt[1] - waistY);
      if (!best || d < best.d) best = { d, pt: [pt[0], pt[1]] };
    }
    return best && best.d < 0.12 ? best.pt : null;
  };

  const upPt = waistPoint(trace.backswing);
  const downPt = waistPoint(trace.downswing);
  if (!upPt || !downPt) return null;

  // Elevation of each ball→waist line, pixel space: height gained over ground covered.
  const elev = (pt: [number, number]) =>
    Math.atan2((ball[1] - pt[1]) * H, Math.abs(pt[0] - ball[0]) * W);
  const pass = elev(downPt) <= elev(upPt) + PLANE_TOLERANCE_RAD;
  const downTone = pass ? ("good" as const) : ("bad" as const);

  // Lines from the ball THROUGH each waist point, run well past it so they read as planes.
  const through = (pt: [number, number], k: number): [number, number] => [
    ball[0] + (pt[0] - ball[0]) * k,
    ball[1] + (pt[1] - ball[1]) * k,
  ];
  const upTop = through(upPt, 1.7);
  const downTop = through(downPt, 1.7);

  const marks: StanceAnnotation[] = [
    { id: "plane-ball", kind: "dot", at: ball, tone: "guide" },
    // The backswing plane first — the reference the downswing is judged against.
    { id: "plane-up", kind: "line", from: ball, to: upTop, tone: "guide" },
    { id: "plane-down", kind: "line", from: ball, to: downTop, tone: downTone, dashed: !pass },
    // Last, the BIG ring around the tops of both lines — the gap between them IS the drop
    // into the shallower delivery. Bigger than a joint ring on purpose.
    {
      id: "drop-ring",
      kind: "circle",
      at: [(upTop[0] + downTop[0]) / 2, (upTop[1] + downTop[1]) / 2],
      r: 0.1,
      tone: "guide",
    },
  ];
  if (pass) {
    // The below-the-plane verdict earns its check, popped beside the drop ring.
    marks.push({
      id: "plane-check",
      kind: "check",
      at: [(upTop[0] + downTop[0]) / 2 + 0.13, (upTop[1] + downTop[1]) / 2 - 0.02],
    });
  }
  return { loop: [cp("P2") ?? p1, p7], holdFrame: p4, marks, verdict: pass ? "pass" : "fail" };
}

export const PLANE_NARRATION = {
  pass: "Watch the loop — back, then down. The two lines are your planes of travel: your downswing drops below your backswing plane, right where power and a square face live.",
  fail: "Watch the loop — back, then down. Your downswing line sits above the plane you took the club back on. That's the over-the-top move: the club cuts across the ball from outside. We'll work on dropping it underneath.",
} as const;

export const DEEP_MOMENTS: readonly DeepMoment[] = [
  {
    key: "takeaway",
    pauseAt: "P2",
    eyebrow: "Backswing",
    title: "Shaft parallel going back",
    narration:
      "First checkpoint: the club works back low and wide, and right about here the shaft runs parallel to the ground. The faint line is that reference — matching it keeps the club in front of your chest instead of whipped inside.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const out: StanceAnnotation[] = [];
      if (at.shaft) {
        // The parallel-to-ground reference, hung off the golfer's own grip end.
        const [bx, by] = at.shaft.butt;
        const dx = at.shaft.head[0] - bx;
        out.push({
          id: "parallel-ref",
          kind: "line",
          from: [bx - dx * 0.2, by],
          to: [at.shaft.head[0] + dx * 0.2, by],
          ghost: true,
        });
        out.push({ id: "shaft", kind: "line", from: at.shaft.butt, to: at.shaft.head, tone: "guide" });
        out.push({ id: "head-ring", kind: "circle", at: at.shaft.head, r: 0.045, tone: "guide" });
      } else if (at.wristMid) {
        out.push({ id: "hands", kind: "circle", at: at.wristMid, r: 0.05, tone: "guide" });
      }
      return { marks: out, verdict: null };
    },
    holdMs: 5200,
  },
  {
    key: "top",
    pauseAt: "P4",
    eyebrow: "Backswing",
    title: "The top of your backswing",
    narration:
      "Paused at the top. Your lead arm stays straight — that's the swing's radius, and it's holding. Hands roughly in front of your trail bicep, shoulders fully turned under a quiet head.",
    alt:
      "Paused at the top. Look at the lead arm — it's breaking down at the elbow. The lead arm should always stay straight: it is the swing's radius, and a bent elbow at the top shortens the arc and costs strike and speed.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const out: StanceAnnotation[] = [];
      if (at.shoulderMid && at.wristMid) {
        out.push({
          id: "depth",
          kind: "line",
          from: at.shoulderMid,
          to: at.wristMid,
          tone: "guide",
          dashed: true,
        });
      }
      if (at.shoulderMid && at.hipMid) {
        out.push({ id: "spine", kind: "line", from: at.shoulderMid, to: at.hipMid, tone: "guide" });
      }

      // The LEAD arm must be straight at the top (Taylor, 2026-08-19) — it is the swing's
      // radius. Bend is the interior angle at the lead elbow, pixel space; past the window
      // the arm draws red with the elbow circled.
      const lead = a.video.handedness === "left" ? "right" : "left";
      const idx = new Map<string, number>();
      a.pose.keypoint_names.forEach((n, i) => idx.set(n, i));
      const fr = a.pose.frames.find((f) => f.f === frame);
      const shoulder = fr ? kpAt(a, fr, idx, `${lead}_shoulder`) : null;
      const elbow = fr ? kpAt(a, fr, idx, `${lead}_elbow`) : null;
      const wrist = fr ? kpAt(a, fr, idx, `${lead}_wrist`) : null;
      let verdict: "pass" | "fail" | null = null;
      if (shoulder && elbow && wrist) {
        const W = a.video.width;
        const H = a.video.height;
        const ang = (o: [number, number], q: [number, number]) =>
          Math.atan2((q[1] - o[1]) * H, (q[0] - o[0]) * W);
        let interior = Math.abs(ang(elbow, shoulder) - ang(elbow, wrist));
        if (interior > Math.PI) interior = 2 * Math.PI - interior;
        const bendDeg = 180 - (interior * 180) / Math.PI;
        const pass = bendDeg <= ARM_BEND_MAX_DEG;
        verdict = pass ? "pass" : "fail";
        const tone = pass ? ("good" as const) : ("bad" as const);
        out.push(
          { id: "upper-arm", kind: "line", from: shoulder, to: elbow, tone },
          { id: "forearm", kind: "line", from: elbow, to: wrist, tone },
        );
        if (pass) {
          out.push({ id: "arm-check", kind: "check", at: [elbow[0] + 0.1, elbow[1] - 0.06] });
        } else {
          out.push({ id: "elbow-ring", kind: "circle", at: elbow, r: 0.05, tone: "bad" });
        }
      } else if (at.wristMid) {
        out.push({ id: "hands", kind: "circle", at: at.wristMid, r: 0.055, tone: "guide" });
      }
      return { marks: out, verdict };
    },
    holdMs: 5600,
  },
  {
    key: "hands-bicep",
    resolveFrame: handsAtBicepFrame,
    eyebrow: "Backswing",
    title: "Hands crossing the bicep line",
    narration:
      "Right here — your hands pass the height of your bicep. The closer they track to that line, the more connected your swing stays. Yours are right on it.",
    alt:
      "Right here — your hands pass the height of your bicep, but they've drifted well past that line. Hands extending too far backward trap the club behind you; feel them stay in front of your chest.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const marks: StanceAnnotation[] = [];
      const trailShoulder = a.video.handedness === "left" ? at.shoulderL : at.shoulderR;
      if (!at.wristMid || !trailShoulder || !at.hipMid) return { marks, verdict: null };
      // The bicep line: horizontal, at the trail upper arm's mid-height. Shoulder→hip
      // stands in for the arm when the elbow abstained (same level, sturdier).
      const bicepY = trailShoulder[1] + (at.hipMid[1] - trailShoulder[1]) * 0.25;
      const bicep: [number, number] = [trailShoulder[0], bicepY];
      const W = a.video.width;
      const H = a.video.height;
      const armPx = Math.hypot(0, (at.hipMid[1] - trailShoulder[1]) * 0.5 * H) || 0.1 * H;
      const offPx = Math.abs((at.wristMid[0] - bicep[0]) * W);
      const pass = offPx <= HANDS_BICEP_TOLERANCE * armPx;
      const tone = pass ? ("good" as const) : ("bad" as const);
      marks.push(
        { id: "bicep-line", kind: "line", from: [bicep[0] - 0.2, bicepY], to: [bicep[0] + 0.2, bicepY], ghost: true },
        { id: "hands-gap", kind: "line", from: bicep, to: at.wristMid, tone, dashed: true },
        { id: "hands", kind: "circle", at: at.wristMid, r: 0.05, tone },
      );
      if (pass) {
        marks.push({ id: "hands-check", kind: "check", at: [at.wristMid[0] + 0.1, at.wristMid[1] - 0.08] });
      }
      return { marks, verdict: pass ? "pass" : "fail" };
    },
    holdMs: 5600,
  },
  {
    key: "transition",
    pauseAt: "P5",
    eyebrow: "Transition",
    title: "The first move down",
    narration:
      "This is the split second the downswing starts — and it starts from the ground. The hips lead while the club is still arriving at the top; that gap is where speed comes from.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const out: StanceAnnotation[] = [];
      if (at.hipMid) out.push({ id: "hips", kind: "circle", at: at.hipMid, r: 0.06, tone: "guide" });
      if (at.shoulderMid && at.hipMid) {
        out.push({
          id: "sep",
          kind: "line",
          from: at.hipMid,
          to: at.shoulderMid,
          tone: "guide",
          dashed: true,
        });
      }
      return { marks: out, verdict: null };
    },
    holdMs: 5200,
  },
  {
    key: "mid-downswing",
    pauseAt: "P6",
    eyebrow: "Downswing",
    title: "Hips outracing shoulders",
    narration:
      "Halfway down — look at the two lines. Your hips are turning faster than your shoulders, exactly the order you want: lower body leads, upper body follows, and that gap is stored speed.",
    alt:
      "Halfway down — your shoulders are keeping pace with your hips. You want the hips winning this race: let the lower body fire first and the shoulders lag a beat behind, and the gap becomes speed at the ball.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const marks: StanceAnnotation[] = [];
      const hipRate = lineRate(a, frame, "left_hip", "right_hip");
      const shoulderRate = lineRate(a, frame, "left_shoulder", "right_shoulder");
      // A rate needs both lines measured across the window; otherwise observe, don't judge.
      const verdict =
        hipRate !== null && shoulderRate !== null
          ? hipRate >= shoulderRate * SEPARATION_RATIO
            ? ("pass" as const)
            : ("fail" as const)
          : null;
      const hipTone = verdict === "fail" ? ("bad" as const) : ("good" as const);
      // The overlay's orientation-rod treatment (Taylor: "extension bars similar to the
      // overlay") — the stage extends and caps the bars; these are the raw joint pairs.
      if (at.shoulderL && at.shoulderR) {
        marks.push({ id: "shoulder-rod", kind: "rod", from: at.shoulderL, to: at.shoulderR, tone: "guide" });
      }
      {
        // Individual hip points (Anchors only carries the mid) — same conf-gated read.
        const idx = new Map<string, number>();
        a.pose.keypoint_names.forEach((n, i) => idx.set(n, i));
        const fr = a.pose.frames.find((f) => f.f === frame) ?? a.pose.frames[0];
        const hipL = fr ? kpAt(a, fr, idx, "left_hip") : null;
        const hipR = fr ? kpAt(a, fr, idx, "right_hip") : null;
        if (hipL && hipR) {
          marks.push({ id: "hip-rod", kind: "rod", from: hipL, to: hipR, tone: hipTone });
        }
      }
      if (verdict === "pass" && at.hipMid) {
        marks.push({ id: "sep-check", kind: "check", at: [at.hipMid[0] + 0.12, at.hipMid[1] - 0.05] });
      }
      return { marks, verdict };
    },
    holdMs: 5600,
  },
  {
    key: "impact",
    pauseAt: "P7",
    eyebrow: "Impact",
    title: "Impact",
    narration:
      "The moment that decides the shot. Hands ahead of the ball, shaft leaning toward the target, hips already open — everything you loaded arriving at once.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const out: StanceAnnotation[] = [];
      if (at.shaft) {
        out.push({ id: "shaft", kind: "line", from: at.shaft.butt, to: at.shaft.head, tone: "guide" });
      }
      const ball = a.club?.ball;
      if (ball) out.push({ id: "ball", kind: "dot", at: [ball.x, ball.y], tone: "good" });
      if (at.wristMid) out.push({ id: "hands", kind: "circle", at: at.wristMid, r: 0.05, tone: "guide" });
      return { marks: out, verdict: null };
    },
    holdMs: 5200,
  },
  {
    key: "finish",
    pauseAt: "P10",
    eyebrow: "Finish",
    title: "Hold the finish",
    narration:
      "Fully released and balanced — belt buckle and chest finishing at the target, weight on the lead side. A finish you can hold is the receipt for everything that came before it.",
    marks: (a, frame) => {
      const at = anchorsAt(a, frame);
      const out: StanceAnnotation[] = [];
      if (at.head) out.push({ id: "head", kind: "circle", at: at.head, r: 0.06, tone: "guide" });

      const W = a.video.width;
      const H = a.video.height;
      const flat = (l: [number, number], r: [number, number]) =>
        Math.abs(
          (Math.atan2(Math.abs((r[1] - l[1]) * H), Math.abs((r[0] - l[0]) * W)) * 180) / Math.PI,
        );

      // Rotation: the hip and shoulder EXTENSION RODS again (Taylor, 2026-08-19) — at the
      // finish both should read at least FLAT toward the target; a rod still steeply
      // slanted is a turn that stopped short.
      let rotFail = false;
      const shoulderOk =
        at.shoulderL && at.shoulderR ? flat(at.shoulderL, at.shoulderR) <= FINISH_ROT_FLAT_DEG : null;
      const hipOk = at.hipL && at.hipR ? flat(at.hipL, at.hipR) <= FINISH_ROT_FLAT_DEG : null;
      if (at.shoulderL && at.shoulderR) {
        const bad = shoulderOk === false;
        rotFail = rotFail || bad;
        out.push({
          id: "shoulder-rod",
          kind: "rod",
          from: at.shoulderL,
          to: at.shoulderR,
          tone: bad ? "bad" : "good",
        });
      }
      if (at.hipL && at.hipR) {
        const bad = hipOk === false;
        rotFail = rotFail || bad;
        out.push({ id: "hip-rod", kind: "rod", from: at.hipL, to: at.hipR, tone: bad ? "bad" : "good" });
      }

      // The trail-foot check — annotated ONLY when it is wrong: a proper finish has the
      // trail heel up, foot on its toe. Foot tilt is heel-above-toe rise over foot length.
      let footFail = false;
      {
        const trail = a.video.handedness === "left" ? "left" : "right";
        const idx = new Map<string, number>();
        a.pose.keypoint_names.forEach((n, i) => idx.set(n, i));
        const fr = a.pose.frames.find((f) => f.f === frame);
        const heel = fr ? kpAt(a, fr, idx, `${trail}_heel`) : null;
        const toe = fr ? kpAt(a, fr, idx, `${trail}_foot_index`) : null;
        if (heel && toe) {
          const lift = (toe[1] - heel[1]) * H;
          const footLen = Math.hypot((toe[0] - heel[0]) * W, (toe[1] - heel[1]) * H);
          const raised = footLen > 0 && lift / footLen >= FINISH_FOOT_LIFT;
          if (!raised) {
            footFail = true;
            out.push(
              { id: "foot", kind: "circle", at: heel, r: 0.05, tone: "bad" },
              // Where the heel should be — straight up off the toe, in guide ink.
              {
                id: "foot-up",
                kind: "line",
                from: heel,
                to: [heel[0], heel[1] - 0.08],
                tone: "guide",
                dashed: true,
              },
            );
          }
        }
      }

      // Two checks share this moment — the override names the fault(s) that actually failed.
      const rotationText =
        "Look at the two bars — your turn stopped short of the target. Keep rotating until your belt buckle and chest finish facing it, at least flat to the line.";
      const footText =
        "Your trail foot is still flat on the ground. In a full release it comes up onto the toe — heel to the sky — because your weight has moved through to the lead side.";
      if (rotFail && footFail) {
        return {
          marks: out,
          verdict: "fail",
          say: `${rotationText} And ${footText.charAt(0).toLowerCase()}${footText.slice(1)}`,
        };
      }
      if (rotFail) return { marks: out, verdict: "fail", say: rotationText };
      if (footFail) return { marks: out, verdict: "fail", say: footText };
      const measured = shoulderOk !== null || hipOk !== null;
      return { marks: out, verdict: measured ? "pass" : null };
    },
    holdMs: 5200,
  },
];
