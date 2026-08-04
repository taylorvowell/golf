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

export type EventName =
  | "address" | "toe_up" | "mid_backswing" | "top"
  | "mid_downswing" | "impact" | "mid_follow_through" | "finish";

export type Keypoint = [number, number, number]; // x, y normalized + confidence

export interface Analysis {
  schema_version: number;
  video: {
    fps: number; frame_count: number; width: number; height: number;
    view: "dtl" | "face_on"; handedness: "right" | "left";
    source: { is_vfr: boolean; codec: string; rotation: number; width: number; height: number };
    analysis_res: { width: number; height: number };
  };
  pose: {
    model: string;
    keypoint_names: string[];
    frames: { f: number; kp: Keypoint[]; st: number[] | null; interp: boolean }[];
  };
  events: Record<EventName, { frame: number; conf: number }> | null;
  phases: { name: string; from: number; to: number }[] | null;
  tempo: {
    ratio: number; backswing_frames: number; downswing_frames: number;
    backswing_ms: number; downswing_ms: number;
  } | null;
  swing_window: [number, number] | null;
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
  /** Stage 6 metrics (doc 05 Part B). Nulls mean "not measurable in this view", not zero. */
  metrics: {
    body_height_norm: number;
    units: string;
    provisional_thresholds: boolean;
    event_snapshots: Record<string, Record<string, number | string | null>>;
    summary: Record<string, number | null>;
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
