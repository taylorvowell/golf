import { MIN_CONF, type Analysis } from "@swingsage/schema/contract";

import type { StanceAnnotation } from "../../design/system";

/**
 * Personalized stance-beat annotations, computed from the golfer's OWN artifact at address —
 * the belt-buckle dot is their `waist`, the shaft line is their detected shaft, the drape line
 * runs shoulder→wrist on their body (Taylor, 2026-08-19: "connection points personalized to
 * the photo and user"). Everything is in the artifact's normalized frame coordinates, which
 * are stage-space once the stage is cut to the frame's aspect.
 *
 * Contract discipline, same as the overlay: indices resolve by NAME from `keypoint_names`
 * (no literal index), and every point re-applies the analyzer's inclusive `conf >= MIN_CONF`
 * gate on truncated confidences. A beat whose anchors don't pass the gate returns null and
 * the caller falls back to the scripted pose-art marks — abstain, never guess.
 *
 * `waist` is the analyzer's RENDERING point — exactly what a drawn belt-buckle marker is
 * allowed to be. No scoring reads it here.
 */

export type Pt = [number, number];

export interface Anchors {
  head: Pt | null;
  shoulderL: Pt | null;
  shoulderR: Pt | null;
  shoulderMid: Pt | null;
  wristMid: Pt | null;
  hipMid: Pt | null;
  hipL: Pt | null;
  hipR: Pt | null;
  waist: Pt | null;
  kneeL: Pt | null;
  kneeR: Pt | null;
  ankleL: Pt | null;
  ankleR: Pt | null;
  elbowL: Pt | null;
  elbowR: Pt | null;
  /** The detected shaft at address, butt first — or a head/butt pair when `shaft` is absent. */
  shaft: { butt: Pt; head: Pt } | null;
}

/**
 * The frame the walkthrough stands on: the LAST frame of the quasi-static address hold —
 * the golfer stationary, right before any backswing begins (Taylor, 2026-08-19: the P1
 * event frame was showing motion). `address_span` ends at the address event; its end is the
 * stillest moment the artifact can name. P1's frame is the fallback for artifacts without a
 * span.
 */
export function addressFrame(a: Analysis): number | null {
  if (a.address_span) return a.address_span[1];
  const p1 = a.checkpoints?.find((c) => c.p === "P1");
  return p1 ? p1.frame : null;
}

/**
 * Shared with the deep swing analysis — anchors work at ANY frame, not just address.
 *
 * `atAddress` turns on the CLUB-HEAD anchoring rule (Taylor, 2026-08-19: "club head should
 * be the anchor point"): at address the head sits AT the ball, and the ball detection is the
 * pipeline's strongest anchor — so a detected head that disagrees with the ball snaps to it,
 * and when the club solve abstained entirely the shaft is synthesized ball→grip (wrists).
 * Address only: anywhere else in the swing the head is nowhere near the ball.
 */
export function anchorsAt(a: Analysis, frame: number, atAddress = false): Anchors {
  const names: readonly string[] = a.pose.keypoint_names;
  const idx = new Map<string, number>();
  names.forEach((n, i) => idx.set(n, i));

  // The pose track is one entry per frame in practice, but the contract only promises `f` —
  // resolve by it, nearest-first, rather than indexing by position.
  let pf = a.pose.frames.find((fr) => fr.f === frame) ?? null;
  if (!pf) {
    let best = Number.POSITIVE_INFINITY;
    for (const fr of a.pose.frames) {
      const d = Math.abs(fr.f - frame);
      if (d < best) {
        best = d;
        pf = fr;
      }
    }
  }

  const kp = (name: string): Pt | null => {
    if (!pf) return null;
    const i = idx.get(name);
    if (i === undefined) return null;
    const entry = pf.kp[i];
    if (!entry || entry[2] < MIN_CONF) return null;
    return [entry[0], entry[1]];
  };
  const mid = (p: Pt | null, q: Pt | null): Pt | null =>
    p && q ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] : null;

  // The club's shaft at (or nearest, within a beat's tolerance of) the same frame.
  let shaft: Anchors["shaft"] = null;
  if (a.club) {
    let best: { d: number; butt: Pt; head: Pt } | null = null;
    for (const cf of a.club.frames) {
      const d = Math.abs(cf.f - frame);
      if (d > 6 || (best && d >= best.d)) continue;
      const butt = cf.butt ?? (cf.shaft && cf.shaft.length >= 2 ? cf.shaft[0] : null);
      const head = cf.head ?? (cf.shaft && cf.shaft.length >= 2 ? cf.shaft[cf.shaft.length - 1] : null);
      if (butt && head) best = { d, butt: [butt[0], butt[1]], head: [head[0], head[1]] };
    }
    if (best) shaft = { butt: best.butt, head: best.head };
  }

  if (atAddress) {
    const ball = a.club?.ball;
    if (ball) {
      const ballPt: Pt = [ball.x, ball.y];
      if (shaft) {
        // The head end must sit on the club head in the PICTURE — at address that is the
        // ball. A solve more than ~5% of the frame away from it is the solve being wrong.
        const off = Math.hypot(shaft.head[0] - ball.x, shaft.head[1] - ball.y);
        if (off > 0.05) shaft = { butt: shaft.butt, head: ballPt };
      } else {
        // No club solve at all — the ball and the hands still define the club's line.
        const wl = kp("left_wrist");
        const wr = kp("right_wrist");
        const wrists = mid(wl, wr);
        if (wrists) shaft = { butt: wrists, head: ballPt };
      }
    }
  }

  return {
    head: kp("nose"),
    shoulderL: kp("left_shoulder"),
    shoulderR: kp("right_shoulder"),
    shoulderMid: mid(kp("left_shoulder"), kp("right_shoulder")),
    wristMid: mid(kp("left_wrist"), kp("right_wrist")),
    hipMid: mid(kp("left_hip"), kp("right_hip")),
    hipL: kp("left_hip"),
    hipR: kp("right_hip"),
    waist: kp("waist"),
    kneeL: kp("left_knee"),
    kneeR: kp("right_knee"),
    ankleL: kp("left_ankle"),
    ankleR: kp("right_ankle"),
    elbowL: kp("left_elbow"),
    elbowR: kp("right_elbow"),
    shaft,
  };
}

/** A short mark centred on a joint — the "look here" underline for knees. */
function jointMark(id: string, p: Pt, tone: "guide" | "good" | "watch"): StanceAnnotation {
  return { id, kind: "line", from: [p[0] - 0.05, p[1] + 0.015], to: [p[0] + 0.05, p[1] - 0.015], tone };
}

/**
 * The belt buckle: the FRONT EDGE of the body at belt height — a buckle sits lower and
 * ball-side of the torso's centre point (Taylor, 2026-08-19). Keypoints give centres, not
 * silhouette edges, so the front edge is approximated as a step from the waist centre toward
 * where the hands hang (the hands hang in front of the body at address), dropped by a
 * fraction of torso length. Constants are stub-tuned at the sign-off walk; the wired feature
 * reads the body edge from the silhouette.
 */
function beltBuckle(at: Anchors): Pt | null {
  if (!at.waist) return null;
  const front = at.shaft?.butt ?? at.wristMid;
  const torso =
    at.shoulderMid && at.hipMid ? Math.abs(at.hipMid[1] - at.shoulderMid[1]) : 0.12;
  const dx = front ? (front[0] - at.waist[0]) * 0.45 : 0;
  return [at.waist[0] + dx, at.waist[1] + torso * 0.22];
}

/** How far off the belt buckle the shaft's landing point may sit and still pass, as a
 *  fraction of torso length — deliberately TIGHT (Taylor, 2026-08-19: the check passed a
 *  shaft that plainly missed). Tuned at the sign-off walk. */
const BELT_TOLERANCE = 0.2;

/** The slight-bend window at address, degrees of flex from straight (0° = locked). Optimal
 *  ≈20°; outside the window fails either way — locked or squatting. Stub-tuned. */
const KNEE_FLEX_MIN_DEG = 10;
const KNEE_FLEX_MAX_DEG = 35;

export interface PersonalizedBeat {
  marks: StanceAnnotation[];
  /** Non-null when the beat carries a real geometric check: "pass" pops the badge, "fail"
   *  turns the highlight red and swaps the narration to the beat's adjust line. */
  verdict: "pass" | "fail" | null;
}

/**
 * The beat's marks on THIS golfer, or null when the anchors it needs did not pass the gate
 * (the caller falls back to the scripted pose art). Keys mirror `stanceScript.ts`.
 */
export function personalizedAnnotations(
  a: Analysis,
  frame: number,
  beatKey: string,
): PersonalizedBeat | null {
  // Every stance beat reads the same address frame, so the club-head/ball anchoring rule
  // applies to the whole walk.
  const at = anchorsAt(a, frame, true);
  const ok = (marks: StanceAnnotation[]): PersonalizedBeat => ({ marks, verdict: null });
  switch (beatKey) {
    case "shaft-line": {
      // The club IS the ruler: extend the shaft's own direction past the butt and see where
      // it lands on the body — never a line drawn straight to the buckle, which made the
      // check unfailable (Taylor caught it passing a shaft that plainly missed). The landing
      // point is the shaft line's intersection with the body's front-edge plane (the
      // vertical through the belt buckle), judged against the buckle with a tight tolerance.
      // All in PIXEL space; normalized axes bend angles.
      const belt = beltBuckle(at);
      const shaft = at.shaft;
      if (!belt || !shaft) return null;
      const W = a.video.width;
      const H = a.video.height;
      const hx = shaft.head[0] * W;
      const hy = shaft.head[1] * H;
      const bx = shaft.butt[0] * W;
      const by = shaft.butt[1] * H;
      const dx = bx - hx;
      const dy = by - hy;
      const ex = belt[0] * W;
      // t past the butt (t=1) to the front-edge plane; a shaft pointing away never reaches.
      const t = Math.abs(dx) > 1e-3 ? (ex - hx) / dx : -1;
      const torsoPx =
        at.shoulderMid && at.hipMid
          ? Math.hypot(
              (at.hipMid[0] - at.shoulderMid[0]) * W,
              (at.hipMid[1] - at.shoulderMid[1]) * H,
            )
          : 0.12 * H;
      let landing: Pt;
      let pass: boolean;
      if (t > 1) {
        const ly = hy + t * dy;
        landing = [ex / W, ly / H];
        pass = Math.abs(ly - belt[1] * H) <= BELT_TOLERANCE * torsoPx;
      } else {
        // Points away from the body entirely — draw the continuation a shaft's length on
        // and fail it there.
        landing = [(bx + dx * 0.9) / W, (by + dy * 0.9) / H];
        pass = false;
      }
      const tone = pass ? ("good" as const) : ("bad" as const);
      const marks: StanceAnnotation[] = [
        // First the club, then "extend the club" — the dotted continuation of its own line.
        { id: "shaft", kind: "line", from: shaft.head, to: shaft.butt, tone: "guide" },
        { id: "extend", kind: "line", from: shaft.butt, to: landing, tone, dashed: true },
        { id: "landing", kind: "dot", at: landing, tone },
        // On a miss the ring is TRANSIENT: circle the problem, clear it, then show the
        // correction — the correction itself is never circled (Taylor, 2026-08-19).
        { id: "landing-ring", kind: "circle", at: landing, r: 0.05, tone, transient: !pass },
      ];
      if (pass) {
        marks.push({
          id: "buckle-check",
          kind: "check",
          at: [landing[0] + 0.1, landing[1] - 0.1],
        });
      } else {
        // The CORRECT line, obvious and dotted — full-strength green from the butt of the
        // club to the belt buckle, drawn after the ring has cleared, on top of everything.
        marks.push(
          { id: "correct-line", kind: "line", from: shaft.butt, to: belt, tone: "good", dashed: true },
          { id: "buckle-target", kind: "dot", at: belt, tone: "good" },
          // ...then the corrected CLUB itself: a new shaft path from the buckle back down to
          // the club head (the old path's start), showing where the club should lean.
          { id: "correct-shaft", kind: "line", from: belt, to: shaft.head, tone: "good" },
        );
      }
      return { marks, verdict: pass ? "pass" : "fail" };
    }
    case "spine-knees": {
      if (!at.shoulderMid || !at.hipMid) return null;
      const marks: StanceAnnotation[] = [];
      // The optimal-angle reference: the scoring config's SET-01 band is 35–45° of forward
      // bend, so the ghost stands at the 40° midpoint — hinged at the golfer's own hips, the
      // golfer's own spine length, leaning the way they lean. Angle math runs in PIXEL space
      // (normalized x and y use different scales) so 40° on screen is really 40°.
      {
        const W = a.video.width;
        const H = a.video.height;
        const hx = at.hipMid[0] * W;
        const hy = at.hipMid[1] * H;
        const sx = at.shoulderMid[0] * W;
        const sy = at.shoulderMid[1] * H;
        const len = Math.hypot(sx - hx, sy - hy);
        if (len > 0) {
          const OPTIMAL_RAD = (40 * Math.PI) / 180;
          const lean = Math.sign(sx - hx) || 1;
          const gx = hx + lean * len * Math.sin(OPTIMAL_RAD);
          const gy = hy - len * Math.cos(OPTIMAL_RAD);
          marks.push({
            id: "spine-optimal",
            kind: "line",
            from: at.hipMid,
            to: [gx / W, gy / H],
            ghost: true,
            // The reference wears its number; the golfer's own spine line NEVER does — the
            // 40° is the config's band midpoint, not a measurement of them.
            label: "40°",
          });
        }
      }
      marks.push({ id: "spine", kind: "line", from: at.shoulderMid, to: at.hipMid, tone: "good" });
      marks.push({
        id: "spine-check",
        kind: "check",
        at: [at.shoulderMid[0] + 0.12, (at.shoulderMid[1] + at.hipMid[1]) / 2 - 0.05],
      });
      return ok(marks);
    }
    case "knee-bend": {
      // The camera-near leg reads cleanest DTL — trail for the artifact's handedness.
      const trail = a.video.handedness === "left";
      const hip = trail ? at.hipL : at.hipR;
      const knee = trail ? at.kneeL : at.kneeR;
      const ankle = trail ? at.ankleL : at.ankleR;
      if (!hip || !knee || !ankle) return null;
      const W = a.video.width;
      const H = a.video.height;
      const ang = (o: Pt, q: Pt) => Math.atan2((q[1] - o[1]) * H, (q[0] - o[0]) * W);
      let interior = Math.abs(ang(knee, hip) - ang(knee, ankle));
      if (interior > Math.PI) interior = 2 * Math.PI - interior;
      const flexDeg = 180 - (interior * 180) / Math.PI;
      const pass = flexDeg >= KNEE_FLEX_MIN_DEG && flexDeg <= KNEE_FLEX_MAX_DEG;
      const tone = pass ? ("good" as const) : ("bad" as const);
      const marks: StanceAnnotation[] = [
        // The straight-leg reference wears the OPTIMAL bend; the golfer's leg wears none.
        { id: "leg-straight", kind: "line", from: hip, to: ankle, ghost: true, label: "20°" },
        { id: "thigh", kind: "line", from: hip, to: knee, tone },
        { id: "shin", kind: "line", from: knee, to: ankle, tone },
        { id: "knee-dot", kind: "dot", at: knee, tone },
      ];
      if (pass) {
        marks.push({ id: "knee-check", kind: "check", at: [knee[0] + 0.12, knee[1] - 0.06] });
      }
      return { marks, verdict: pass ? "pass" : "fail" };
    }
    case "arm-drape": {
      if (!at.shoulderMid || !at.wristMid) return null;
      return ok([
        // Plumb vertical from the golfer's own shoulder — the "draped by gravity" reference.
        {
          id: "drape-plumb",
          kind: "line",
          from: at.shoulderMid,
          to: [at.shoulderMid[0], at.wristMid[1]],
          ghost: true,
        },
        { id: "drape", kind: "line", from: at.shoulderMid, to: at.wristMid, tone: "guide" },
        { id: "wrists", kind: "circle", at: at.wristMid, r: 0.05, tone: "good" },
        { id: "drape-check", kind: "check", at: [at.wristMid[0] + 0.1, at.wristMid[1] - 0.08] },
      ]);
    }
    case "free-look": {
      if (!at.head) return null;
      return ok([
        { id: "head", kind: "circle", at: at.head, r: 0.06, tone: "guide" },
        { id: "head-check", kind: "check", at: [at.head[0] + 0.09, at.head[1] - 0.05] },
      ]);
    }
    case "shoulder-lean": {
      // Only meaningful on a face-on artifact — the screen calls this per-beat only when the
      // artifact's view matches the beat's, so DTL's overlapping shoulders never land here.
      if (!at.shoulderL || !at.shoulderR) return null;
      return ok([
        { id: "shoulders", kind: "line", from: at.shoulderL, to: at.shoulderR, tone: "good" },
        { id: "lean-check", kind: "check", at: [at.shoulderR[0] + 0.07, at.shoulderR[1] - 0.07] },
      ]);
    }
    case "knee-flex": {
      if (!at.kneeL || !at.kneeR) return null;
      return ok([
        jointMark("knee-l", at.kneeL, "guide"),
        jointMark("knee-r", at.kneeR, "guide"),
        { id: "knees-check", kind: "check", at: [(at.kneeL[0] + at.kneeR[0]) / 2, Math.min(at.kneeL[1], at.kneeR[1]) - 0.08] },
      ]);
    }
    case "wrap":
      return ok([]);
    default:
      return null;
  }
}

function mid2(p: Pt, q: Pt): Pt {
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}
