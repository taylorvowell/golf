import fs from "node:fs/promises";
import path from "node:path";

/**
 * The web app never runs CV — it reads what the Python analyzer wrote (doc 00 principle 2).
 * Until the v1 job queue and SQLite land, "the database" is the analyzer's output folder:
 * one directory per swing, each containing analysis.json plus its normalized video.
 */
export const MEDIA_ROOT =
  process.env.SWINGSAGE_MEDIA_ROOT ??
  path.resolve(process.cwd(), "..", "..", "services", "analyzer", "out");

/**
 * The schema this player is written against. Keep in step with `SCHEMA_VERSION` in
 * `scripts/burnin.py`.
 *
 *   1  original pose/club/events/metrics contract
 *   2  + club.detector (provenance + raw boxes), + club.variants (alternative solutions)
 *   3  + checkpoints (P1–P10), + metrics.checkpoints / angle_fields (the angle catalogue
 *      and each angle's drawing geometry). Also where keypoint confidence began being
 *      truncated rather than rounded, so a v2 artifact's overlay can disagree with its own
 *      label by ~2° where a confidence rounded up onto the MIN_CONF gate (DECISIONS D33).
 *   4  + club.frames[].from_model and the trace-only club variants.
 *   5  + playback_window — the span of the clip worth playing. The player derives a fallback
 *      from the events on older artifacts, so this one degrades rather than breaking.
 *   6  + club.trace_frames — which frame each trace point was measured on. Without it the
 *      trace can only be grown by point count, which put the head of the line up to 34 frames
 *      from the club, and the spans nothing was measured in cannot be told apart from measured
 *      path (D43). Older artifacts fall back to the even spread, so this degrades too.
 *   7  + keypoint 48 `waist`, a derived belt-line torso node (the midpoint of `spine_mid`
 *      and `mid_hip`). Nothing here reads it by index and no bone was re-routed through it —
 *      the renderer skips joints an artifact does not carry — so a v6 artifact renders
 *      identically, just without the dot.
 *   8  + posture.butt_line, the DTL setup reference the seat should stay against.
 *   9  + playback_pad — frames of the fixed 1s approach / 1s finish the clip is too short to
 *      supply, held as a freeze frame so every swing's lead-in and run-out are the same
 *      length however short the footage is. The window itself is now pinned to
 *      `address − 1s … finish + 1s`, where it used to run on to a second past the golfer
 *      settling: more faithful to one swing, and inconsistent across the several a
 *      comparison puts side by side.
 */
export const CURRENT_SCHEMA = 9;

/**
 * What a stored analysis is missing relative to what this player can render.
 *
 * Checked by **capability, not version arithmetic**. An artifact can legitimately carry a new
 * schema number while lacking an optional block (a swing analysed without `--club-detector`
 * has no detector data no matter how new it is), and an old artifact can be perfectly usable.
 * Asking "what can't I show?" is the question that has a useful answer.
 *
 * This exists because the alternative — silently hiding controls whose data is absent — is
 * indistinguishable from a broken UI, and cost real debugging time.
 */
export function missingCapabilities(a: Analysis): string[] {
  const missing: string[] = [];
  // Checked before the club early-return: these come from pose and exist on a --no-club run.
  if (!a.checkpoints?.length) missing.push("the ten swing checkpoints (P1–P10)");
  if (!a.metrics?.checkpoints?.length) missing.push("angles at each checkpoint");
  // Geometry is what makes an angle selectable; without it the table renders but nothing can
  // be drawn on the video, which is the "controls that look broken" case this list exists for.
  else if (!a.metrics.angle_fields?.some((f) => f.geom)) missing.push("angle overlays");
  if (!a.club) return missing; // club tracking was skipped outright; not a staleness issue
  if (!a.club.detector?.boxes?.length) missing.push("raw club-detector output");
  if (!a.club.variants || !Object.keys(a.club.variants).length) {
    missing.push("alternative club solutions");
  }
  return missing;
}

export type EventName =
  | "address" | "toe_up" | "mid_backswing" | "top"
  | "mid_downswing" | "impact" | "mid_follow_through" | "finish";

/**
 * The ten coaching positions (P1–P10). Eight are the GolfDB events above under the names a
 * golfer uses; P6 (shaft parallel coming down) and P9 (trail arm parallel through) are the
 * two the eight do not cover. `event` is null for exactly those two.
 */
export interface Checkpoint {
  p: string;
  id: string;
  label: string;
  phase: "setup" | "backswing" | "downswing" | "impact" | "follow_through" | "finish";
  event: EventName | null;
  frame: number;
  conf: number;
  /** How this frame was decided, in words — so a low confidence is diagnosable. */
  basis: string;
  definition: string;
}

/**
 * A point in an angle's geometry: a keypoint name, a first-tracked-wins chain (optionally
 * told by `src` which per-frame series field recorded the anchor that actually answered),
 * a fraction along heel→toe averaged over both feet, or the tracked club head.
 */
export type PointExpr =
  | string
  | { chain: string[]; src?: string }
  | { feet: number }
  | { club: "head" };

/**
 * Where an angle lives on the body, so the player can draw it over the video. Every kind is
 * a vertex plus two rays; they differ only in what the second ray is — another bone
 * (`interior`), straight up (`vertical`), straight down (`plumb`), or along +x
 * (`horizontal`, which is what the stack and tilt angles are measured from).
 *
 * `supplement` marks a `_flex` field, whose arc opens from the bone's continuation through
 * the joint because the number is departure from straight. `vectors` is for wrist hinge
 * alone: forearm and shaft share no endpoint, so no single vertex would be honest.
 */
export interface AngleGeom {
  kind: "interior" | "vertical" | "plumb" | "horizontal" | "vectors";
  vertex?: PointExpr; a?: PointExpr; b?: PointExpr; supplement?: boolean;
  from?: PointExpr; to?: PointExpr; guide?: "plumb";
  at?: PointExpr; u?: [PointExpr, PointExpr]; v?: [PointExpr, PointExpr];
}

/** One row of the angle catalogue, emitted by the analyzer so the table is data-driven. */
export interface AngleField {
  field: string;
  label: string;
  /** The view the number means what its name says in; computed but misleading elsewhere. */
  view: "both" | "dtl" | "face_on";
  /** False where the field is already measured against address. */
  delta: boolean;
  /** "setup" fields are only interpretable at P1 (arm hang at the top is meaningless). */
  when: "setup" | "swing" | "both";
  /** null where the angle has no drawable geometry — the width-derived rotation estimates. */
  geom: AngleGeom | null;
}

export type Keypoint = [number, number, number]; // x, y normalized + confidence

/**
 * One raw detection from the club detector, exactly as the model emitted it.
 * `c` is the class id (0 clubhead, 1 stick), `xy` the box centre, `wh` its size — both
 * normalised — and `p` the model's own confidence.
 */
export type RawBox = {
  c: number; xy: [number, number]; wh: [number, number]; p: number;
};

export interface Analysis {
  schema_version: number;
  /**
   * Club-tracking experiment results (12-test plan, D55). Optional and append-only: the
   * block appears the first time `scripts/club_test.py` merges an experiment; legacy
   * artifacts simply lack it. Not part of `CURRENT_SCHEMA` on purpose.
   */
  club_tracking?: import("@/lib/clubTests").ClubTrackingBlock | null;
  video: {
    fps: number; frame_count: number; width: number; height: number;
    view: "dtl" | "face_on"; handedness: "right" | "left";
    source: {
      /** Absolute path to the clip this was produced from — what re-analysis re-reads. */
      path: string;
      is_vfr: boolean; codec: string; rotation: number; width: number; height: number;
    };
    analysis_res: { width: number; height: number };
  };
  pose: {
    model: string;
    keypoint_names: string[];
    frames: { f: number; kp: Keypoint[]; st: number[] | null; interp: boolean }[];
  };
  events: Record<EventName, { frame: number; conf: number }> | null;
  /** P1–P10. Absent on analyses produced before Stage 5b existed. */
  checkpoints: Checkpoint[] | null;
  phases: { name: string; from: number; to: number }[] | null;
  tempo: {
    ratio: number; backswing_frames: number; downswing_frames: number;
    backswing_ms: number; downswing_ms: number;
  } | null;
  /** Stage 3's motion-burst gate, around the hand-speed peak. Far too tight to play. */
  swing_window: [number, number] | null;
  /**
   * The span of the clip worth playing: ~1s of approach, the swing, and ~1s of the held
   * finish. Everything outside it is the golfer settling in and then walking off.
   *
   * Absent on artifacts produced before schema 5; `lib/playbackWindow.ts` derives an
   * equivalent from the events in that case, so the player never falls back to the whole clip.
   */
  playback_window?: [number, number] | null;
  /**
   * Frames of the fixed 1s approach / 1s run-out this clip is too short to supply, held as a
   * freeze frame by the player so every swing's lead-in and follow-out are the same length.
   * Absent before schema 9; `lib/playbackWindow.ts` derives it from the events in that case.
   */
  playback_pad?: [number, number] | null;
  /** The quasi-static hold ending at the address event; setup metrics are medians over it. */
  address_span: [number, number] | null;
  club: {
    club_len: number;
    coverage: Record<string, number>;
    trace_enabled: boolean;
    notes: string[];
    butt_len: number;
    frames: {
      f: number; shaft: [number, number][] | null; head: [number, number] | null;
      butt: [number, number] | null;
      conf: number; shaft_angle_deg: number | null; blurred: boolean; interp: boolean;
      /** Placed on the ball at Impact from the Address landmark, not found in this frame
       *  (`club.anchor_ball`). Never the same thing as a detection. */
      from_ball?: boolean;
    }[];
    trace: Record<"backswing" | "downswing" | "followthrough", [number, number][]>;
    /**
     * The frame each trace point was measured on, parallel to `trace`. Absent on artifacts
     * produced before schema 6.
     *
     * The trace is NOT one point per frame — the trace modes keep only the frames the detector
     * answered — so growing the path with the playhead by point count puts the head of the line
     * tens of frames from the club. It is also what tells the renderer which spans were bridged
     * (a frame step > 2) and should therefore be drawn as unmeasured.
     */
    trace_frames?: Record<"backswing" | "downswing" | "followthrough", number[]> | null;
    /**
     * The learned club detector's provenance and its RAW output. Null when the swing was
     * analysed without `--club-detector`.
     *
     * `boxes` is deliberately unprocessed: every detection the model returned, with no
     * confidence gate, no geometric rejection and no dependence on the solver. It exists so
     * the model can be judged separately from the pipeline's interpretation of it — the rest
     * of this block is that interpretation. Coordinates are normalised the same way as
     * everything else (x by width, y by height).
     */
    detector: {
      weights: string; sha256: string; bytes?: number;
      imgsz?: number; conf?: number; device?: string;
      frames?: number; frames_with_head?: number; head_detections?: number;
      names?: Record<string, string>;
      /** Which classes fed the solver: "none" | "heads" | "sticks" | "both". */
      inject?: string;
      classes?: Record<string, string>;
      boxes?: { f: number; d: RawBox[] }[];
    } | null;
    /**
     * Alternative club solutions over the same frames and the same detections. Render-only —
     * metrics, face and event refinement all read the primary block. Present so the player can
     * switch between them without re-running the analyzer, because there is no ground-truth
     * position metric yet to choose a winner (DECISIONS D20/D32).
     */
    variants?: Record<string, {
      label: string;
      coverage: Record<string, number>;
      club_len: number;
      butt_len: number;
      notes: string[];
      frames: {
        f: number; shaft: [number, number][] | null; head: [number, number] | null;
        butt: [number, number] | null; conf: number; interp: boolean;
        from_ball?: boolean;
      }[];
      trace: Record<"backswing" | "downswing" | "followthrough", [number, number][]>;
      trace_frames?: Record<"backswing" | "downswing" | "followthrough", number[]> | null;
    }> | null;
  } | null;
  quality: {
    frames: number; detection_coverage: number; overall_mean_conf: number;
    per_joint: Record<string, { coverage: number; mean_conf: number }>;
  };
  /**
   * Club head orientation only — never an impact face angle (doc 04 §6). `checkpoints`
   * entries either carry a classification or say why they are not measurable; the impact
   * entry always defers to launch monitor data.
   */
  face: {
    checkpoints: Record<string, {
      class: string; conf: number; reason?: string;
      head_to_shaft_deg?: number; deviation_deg?: number; n_frames?: number;
    }>;
    frames: { f: number; head_axis_deg: number | null; to_shaft_deg: number | null; conf: number }[];
    capability_note: string;
  } | null;
  /**
   * Stage 6 metrics (doc 05 Part B). Nulls mean "not measurable in this view", not zero.
   *
   * Side-keyed fields are `lead_`/`trail_`, never `left_`/`right_` — lead is the side
   * closest to the target (docs/GLOSSARY.md). Keypoint names stay anatomical.
   */
  metrics: {
    body_height_norm: number;
    units: string;
    provisional_thresholds: boolean;
    /** Standard coaching terms mapped onto the fields above — see docs/GLOSSARY.md. */
    glossary: Record<string, unknown> | null;
    /** Resolved handedness → lead/trail mapping, so no consumer re-derives it. */
    sides: { handedness: string; lead: string; trail: string; note: string } | null;
    series: Record<string, number | string | boolean | null>[];
    event_snapshots: Record<string, Record<string, number | string | boolean | null>>;
    /**
     * The same swing indexed by the ten coaching positions rather than the eight events,
     * with every angle at each and its change from address. This is what the angle table
     * renders; `event_snapshots` stays for consumers keyed to the GolfDB names.
     */
    checkpoints: (Checkpoint & {
      values: Record<string, number | string | boolean | null>;
      delta_from_address: Record<string, number>;
    })[] | null;
    checkpoint_notes: string[] | null;
    /** Drives the angle table, so the field list is never duplicated on this side. */
    angle_fields: AngleField[] | null;
    summary: Record<string, number | string | null>;
  } | null;
  /**
   * Setup reference geometry measured off the golfer's silhouette (Stage 2b), not off
   * keypoints — a coaching line is tangent to the body's *outline*, which no keypoint knows
   * about. Null on anything analysed before schema 8, and on face-on clips, where the rear of
   * the pelvis points at neither edge of frame and the tangent would mean nothing.
   */
  posture: {
    butt_line: ButtLine | null;
    /** Why there is no line, when there isn't one — shown rather than silently hiding. */
    notes: string[];
  } | null;
  quality_raw: Analysis["quality"] | null;
  quality_mediapipe: Analysis["quality"] | null;
  stage3: Record<string, unknown> | null;
}

/**
 * The down-the-line posture line: a vertical tangent to the rear of the seat, taken as a
 * median over the address hold and then held for the whole clip. The golfer's seat should stay
 * in contact with it through the backswing; leaving it toward the ball is early extension.
 */
export interface ButtLine {
  /** Normalized x. Fixed for every frame — that is the entire point of the drill. */
  x: number;
  /** The drawn extent, band plus a little air at each end. */
  y0: number; y1: number;
  /** The rows the tangent was actually measured over. */
  band: [number, number];
  /** The address frame it is locked at, and the span of frames it was measured over. */
  frame: number;
  frames: [number, number];
  n: number;
  /** Image direction the seat faces: -1 left of the golfer, +1 right. */
  side: -1 | 1;
  /** How much the seat wandered across the address hold, in body heights. */
  spread_bh: number;
  conf: number;
  source: string;
}

/**
 * The golfer's outline per frame — `silhouette.json`, a separate artifact from
 * `analysis.json` because it is large (0.3–1.1 MB) and only wanted when its overlay is on.
 * Fetched lazily by `lib/useSilhouette.ts`; never part of the page's first load.
 *
 * `p` is a list of closed rings with **no outer/hole distinction**, deliberately: filling them
 * all under an even-odd rule puts the holes back by itself (the gap between the arms at the
 * top of the backswing is a hole), so no consumer has to classify them.
 */
export interface Silhouette {
  schema: number;
  source: string;
  model: string;
  eps: number;
  width: number; height: number;
  frame_count: number;
  coverage: number;
  notes: string[];
  frames: { f: number; p: [number, number][][] }[];
}

export interface SwingSummary {
  id: string;
  frameCount: number;
  fps: number;
  view: string;
  overallScore: number | null;
  band: string | null;
  scoringModelVersion: string | null;
  status: string;
  createdAt: number;
  // Display-only extras still read from `analysis.json` (the CV artifact of record — see
  // CLAUDE.md's Architecture section) rather than denormalized onto the `swings` row. Cheap at
  // today's swing counts; if the log grows large enough for N-file-reads-per-page-load to
  // matter, promote these to columns written at analysis time the same way frameCount/fps/
  // width/height already are — an additive migration, not a rearchitecture (docs/DECISIONS.md
  // D38's "what this does not change" already anticipates exactly this kind of follow-up).
  model: string | null;
  tempoRatio: number | null;
  traceEnabled: boolean;
  poseCoverage: number;
}

/** Guard against `..` and absolute paths — ids come straight from the URL. */
function safeId(id: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("invalid swing id");
  return id;
}

export function swingFile(id: string, name: string) {
  return path.join(MEDIA_ROOT, safeId(id), name);
}

/**
 * The swing log, scoped to one user (`docs/SCORING-CRITERIA-TRIAGE.md`-adjacent: "log swings by
 * user" — the seeded admin user today, a real session's user id once auth exists). Replaces the
 * directory scan this used to be: identity, ownership and sort order now come from Postgres
 * (`docs/DECISIONS.md` D38), not from listing `MEDIA_ROOT` and hoping every folder has a
 * readable `analysis.json`.
 */
export async function listSwings(userId: string): Promise<SwingSummary[]> {
  // Imported lazily so this module (used by API routes that don't touch the DB, like the video
  // and thumb streamers) doesn't require DATABASE_URL to be set just to load.
  const { db } = await import("../db/client");
  const { swings } = await import("../db/schema");
  const { eq, desc } = await import("drizzle-orm");

  const rows = await db.select().from(swings)
    .where(eq(swings.userId, userId))
    .orderBy(desc(swings.createdAt));

  const out: SwingSummary[] = [];
  for (const row of rows) {
    let model: string | null = null;
    let tempoRatio: number | null = null;
    let traceEnabled = false;
    let poseCoverage = 0;
    try {
      const a = JSON.parse(
        await fs.readFile(path.join(row.mediaPath, "analysis.json"), "utf8")
      ) as Analysis;
      const joints = Object.values(a.quality?.per_joint ?? {});
      model = a.pose.model;
      tempoRatio = a.tempo?.ratio ?? null;
      traceEnabled = !!a.club?.trace_enabled;
      poseCoverage = joints.length
        ? joints.reduce((s, j) => s + j.coverage, 0) / joints.length
        : 0;
    } catch {
      // Row exists but the artifact isn't readable (mid-analysis, or media moved) — still show
      // the row with its DB-known fields rather than dropping it from the log.
    }

    out.push({
      id: row.id,
      frameCount: row.frameCount ?? 0,
      fps: row.fps ?? 0,
      view: row.view,
      overallScore: row.overallScore,
      band: row.band,
      scoringModelVersion: row.scoringModelVersion,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      model,
      tempoRatio,
      traceEnabled,
      poseCoverage,
    });
  }
  return out;
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  try {
    return JSON.parse(await fs.readFile(swingFile(id, "analysis.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The per-frame outline, if this swing has one. Absent for every swing analysed before Stage
 * 2b existed and for any run passed `--no-silhouette`, so the caller must handle null — the
 * overlay group hides itself rather than offering a toggle that draws nothing.
 *
 * Deliberately NOT folded into `getAnalysis`: this is up to a megabyte, the swing page loads
 * the analysis on every visit, and most visits never turn the silhouette on.
 */
export async function getSilhouette(id: string): Promise<Silhouette | null> {
  try {
    return JSON.parse(await fs.readFile(swingFile(id, "silhouette.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Whether the silhouette artifact exists, without reading a megabyte to find out.
 *
 * The swing page needs this at render time to decide whether the overlay group is offered at
 * all; the data itself is fetched by the browser only once that toggle goes on.
 */
export async function hasSilhouette(id: string): Promise<boolean> {
  try {
    await fs.access(swingFile(id, "silhouette.json"));
    return true;
  } catch {
    return false;
  }
}
