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
 */
export const CURRENT_SCHEMA = 5;

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
    }[];
    trace: Record<"backswing" | "downswing" | "followthrough", [number, number][]>;
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
      }[];
      trace: Record<"backswing" | "downswing" | "followthrough", [number, number][]>;
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
  quality_raw: Analysis["quality"] | null;
  quality_mediapipe: Analysis["quality"] | null;
  stage3: Record<string, unknown> | null;
}

export interface SwingSummary {
  id: string;
  model: string;
  frameCount: number;
  fps: number;
  view: string;
  tempoRatio: number | null;
  traceEnabled: boolean;
  poseCoverage: number;
  modifiedAt: number;
}

/** Guard against `..` and absolute paths — ids come straight from the URL. */
function safeId(id: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("invalid swing id");
  return id;
}

export function swingFile(id: string, name: string) {
  return path.join(MEDIA_ROOT, safeId(id), name);
}

export async function listSwings(): Promise<SwingSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(MEDIA_ROOT);
  } catch {
    return [];
  }

  const out: SwingSummary[] = [];
  for (const id of entries) {
    try {
      const p = path.join(MEDIA_ROOT, id, "analysis.json");
      const [stat, raw] = await Promise.all([fs.stat(p), fs.readFile(p, "utf8")]);
      const a = JSON.parse(raw) as Analysis;
      const joints = Object.values(a.quality?.per_joint ?? {});
      out.push({
        id,
        model: a.pose.model,
        frameCount: a.video.frame_count,
        fps: a.video.fps,
        view: a.video.view,
        tempoRatio: a.tempo?.ratio ?? null,
        traceEnabled: !!a.club?.trace_enabled,
        poseCoverage: joints.length
          ? joints.reduce((s, j) => s + j.coverage, 0) / joints.length
          : 0,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // Directory without a readable analysis.json is mid-analysis or failed; skip it.
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  try {
    return JSON.parse(await fs.readFile(swingFile(id, "analysis.json"), "utf8"));
  } catch {
    return null;
  }
}
