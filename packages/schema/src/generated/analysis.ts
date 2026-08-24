/* GENERATED from schemas/analysis.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * [x, y, confidence] — position normalized 0–1, confidence TRUNCATED to the artifact's precision so re-applying MIN_CONF on the client keeps the analyzer's own answer.
 *
 * @minItems 3
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "keypoint".
 */
export type Keypoint = [number, number, number];
/**
 * Inclusive [from, to] frame indices.
 *
 * @minItems 2
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "frameRange".
 */
export type FrameRange = [number, number];
/**
 * A normalized [x, y] position — x by frame width, y by frame height.
 *
 * @minItems 2
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "point".
 */
export type Point = [number, number];
/**
 * Where a piece of an angle's geometry lives: a keypoint name, a first-tracked-wins chain (optionally told by `src` which per-frame series field recorded the anchor that answered), a fraction along heel→toe averaged over both feet, or the tracked club head.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "pointExpr".
 */
export type PointExpr = string | PointChain | PointFeet | PointClub;
/**
 * @minItems 2
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "pointPair".
 */
export type PointPair = [PointExpr, PointExpr];
/**
 * @minItems 2
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "numberPair".
 */
export type NumberPair = [number, number];

/**
 * The single contract between the analyzer and every client — one artifact per analysed video.
 *
 * Two rules govern everything below.
 *
 * STRICT ON SHAPE, PERMISSIVE ON PRESENCE. Every field a client renders is described here so the generated TypeScript is complete, but `required` stays confined to what the pipeline has always emitted. A block absent because the run skipped it (`--no-club`) is not a contract break; a block whose `head` stopped being a normalised pair is.
 *
 * ADDITIVE ONLY. Unknown properties validate — a client built for schema 9 must keep working against an artifact written at 11, because a native app cannot be force-updated and old builds read these artifacts for months. `shape-lock.json` enforces the other direction: nothing here may be removed, retyped, or newly required.
 *
 * Coordinates are normalized 0–1 (x right, y down) so a client only ever scales. Confidence is truncated, never rounded — a value rounding up onto MIN_CONF makes a client draw a point the analyzer dropped.
 */
export interface Analysis {
  /**
   * Incremented when the contract changes. Clients must tolerate a HIGHER value than they were built for by ignoring unknown fields.
   */
  schema_version: number;
  video: VideoInfo;
  pose: Pose;
  events: Events;
  /**
   * P1–P10. Null on analyses produced before Stage 5b existed.
   */
  checkpoints?: Checkpoint[] | null;
  phases: Phase[] | null;
  /**
   * Stage 3's motion-burst gate, around the hand-speed peak. Far too tight to play.
   */
  swing_window: FrameRange | null;
  /**
   * The span worth playing, pinned to address − 1s … finish + 1s so every clip's lead-in and run-out match. Absent before schema 5; the player derives an equivalent from the events, so it degrades rather than breaking. The comparison view depends on it.
   */
  playback_window?: FrameRange | null;
  /**
   * Frames of the fixed one second the clip was too short to supply, held as a freeze frame so every swing's lead-in and run-out are the same length. Absent before schema 9.
   */
  playback_pad?: FrameRange | null;
  /**
   * The quasi-static hold ending at the address event; setup metrics are medians over it.
   */
  address_span: FrameRange | null;
  tempo: Tempo | null;
  /**
   * Null when the swing was analysed with --no-club.
   */
  club: Club | null;
  /**
   * Club head ORIENTATION only. Never a fabricated impact face angle — degrees require a launch monitor, and the impact entry always defers to one.
   */
  face: Face | null;
  metrics: Metrics | null;
  posture?: Posture | null;
  quality: Quality;
  /**
   * The same coverage figures before postprocessing, so a gain can be attributed.
   */
  quality_raw: Quality | null;
  /**
   * The MediaPipe baseline, present only on an RTMPose run.
   */
  quality_mediapipe: Quality | null;
  /**
   * Postprocessing counters — how many joints were swapped, rejected, promoted or interpolated.
   */
  stage3: OpenMap | null;
  /**
   * The ball strike as HEARD, from the clip's own audio track — an independent second witness to Impact, never a replacement for it. The video-side events are measured from the club head and the hands and are far more precise; this shares none of their failure modes, which is the entire point. Null when the clip has no audio, or nothing that sounds like a strike was heard — both normal answers. Absent before schema 10.
   */
  audio_impact?: {
    /**
     * The heard strike, as a frame index in THIS artifact's normalized clip. Carries the recording pipeline's audio latency, measured at 121–148 ms on five stock-camera takes and never measured on SwingSage's own recorder — so it is good to a couple of hundred milliseconds and no better. Never snap a rendered event to it.
     */
    frame: number;
    time_sec: number;
    /**
     * How far clear of the next-best candidate this one stood. SEPARATION, not strength: a loud clip is not a confident one, and two similar candidates are exactly the case a consumer has to be told about.
     */
    confidence: number;
    /**
     * Whether the video-side Impact event lands within tolerance of the heard strike. FALSE IS THE VALUABLE CASE: it means the two witnesses disagree, and a renderer should say so rather than draw confident phase bands. On the 7wood-1 fixture the stored Impact is ~40 frames after the ball leaves the mat and this is the flag that catches it.
     */
    agrees: boolean;
    /**
     * Video Impact minus heard strike, in frames. Signed.
     */
    delta_frames?: number;
  } | null;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "video".
 */
export interface VideoInfo {
  /**
   * The CFR rate the clip was normalized to. `frame = round(currentTime * fps)` is only exact because of that normalization.
   */
  fps: number;
  frame_count: number;
  width: number;
  height: number;
  view: "dtl" | "face_on";
  /**
   * Sets which anatomical side is lead. Never inferred from which side faces the camera — that inverts for a left-handed golfer.
   */
  handedness: "right" | "left";
  source: VideoSource;
  analysis_res: Resolution;
}
/**
 * The clip this artifact was produced from, as it arrived — before CFR normalization.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "videoSource".
 */
export interface VideoSource {
  /**
   * Absolute path to the clip; what a re-analysis re-reads.
   */
  path: string;
  /**
   * True when the phone wrote variable frame rate, which breaks frame ↔ time arithmetic until normalized.
   */
  is_vfr: boolean;
  codec: string;
  rotation: number;
  width: number;
  height: number;
  fps: number;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "resolution".
 */
export interface Resolution {
  width: number;
  height: number;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "pose".
 */
export interface Pose {
  model: string;
  /**
   * Fixed, APPEND-ONLY order: 33 native, 7 derived, 8 measured, 1 derived-tail. The measured block sits after the derived one precisely so published indices 0–39 keep their meaning. Undo the derived joints with skeleton.strip_derived() — the two derived blocks are not contiguous.
   *
   * @minItems 49
   */
  keypoint_names: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    ...string[]
  ];
  frames: PoseFrame[];
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "poseFrame".
 */
export interface PoseFrame {
  f: number;
  /**
   * One entry per published keypoint name, in that order.
   */
  kp: Keypoint[];
  /**
   * Per-keypoint provenance state, when the postprocessor recorded one.
   */
  st: number[] | null;
  /**
   * This frame's pose was interpolated rather than detected.
   */
  interp: boolean;
}
/**
 * The eight GolfDB events, strictly ordered by frame. Ordering itself is not expressible in JSON Schema — `eventsAreOrdered()` checks it.
 */
export interface Events {
  [k: string]: SwingEvent;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "event".
 */
export interface SwingEvent {
  frame: number;
  conf?: number;
}
/**
 * One of the ten coaching positions (P1–P10). Eight are the GolfDB events under the names a golfer uses; P6 (shaft parallel coming down) and P9 (trail arm parallel through) are the two the eight do not cover, and `event` is null for exactly those.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "checkpoint".
 */
export interface Checkpoint {
  p: string;
  id: string;
  label: string;
  phase: "setup" | "backswing" | "downswing" | "impact" | "follow_through" | "finish";
  event: string | null;
  frame: number;
  conf: number;
  /**
   * How this frame was decided, in words — so a low confidence is diagnosable rather than merely low.
   */
  basis: string;
  definition: string;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "phase".
 */
export interface Phase {
  name: string;
  from: number;
  to: number;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "tempo".
 */
export interface Tempo {
  backswing_frames: number;
  downswing_frames: number;
  ratio: number;
  backswing_ms: number;
  downswing_ms: number;
  /**
   * Null when tempo is plausible; otherwise the reasons it should not be trusted. Non-empty means the pipeline is flagging its own output, and a client must surface that rather than printing the ratio as fact.
   */
  implausible?: string[] | null;
}
/**
 * The per-frame club head and the drawn trace are DIFFERENT PRODUCTS. `frames` is judged by checkclub.py, `trace` by checktrace.py; a good sheet for one says nothing about the other.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "club".
 */
export interface Club {
  club_len: number;
  butt_len: number;
  coverage: ClubCoverage;
  /**
   * False when club coverage was too low to draw an honest line. The analysis still succeeds; the trace is disabled and club-dependent checks abstain.
   */
  trace_enabled: boolean;
  notes: string[];
  ball?: Ball | null;
  /**
   * Null when the swing was analysed without --club-detector.
   */
  detector?: ClubDetector | null;
  frames: ClubFrame[];
  trace: TraceSegments;
  trace_frames?: TraceFrames | null;
  variants?: {
    [k: string]: ClubVariant;
  } | null;
}
/**
 * Fraction of frames with a club position, per segment. Coverage has overstated club quality three separate times — look at checkclub.py before believing it.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "clubCoverage".
 */
export interface ClubCoverage {
  [k: string]: number;
}
/**
 * The ball, when it was located — normalized, with `r` the radius as a fraction of frame height. Null when it could not be found, never a guess: anchor_ball writes a club position from it.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "ball".
 */
export interface Ball {
  x: number;
  y: number;
  r: number;
  source: string;
}
/**
 * The learned detector's provenance and its RAW output. `boxes` is deliberately unprocessed — no confidence gate, no geometric rejection, no dependence on the solver — so the model can be judged separately from the pipeline's interpretation of it.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "clubDetector".
 */
export interface ClubDetector {
  weights: string;
  sha256: string;
  bytes?: number;
  imgsz?: number;
  conf?: number;
  device?: string;
  frames?: number;
  frames_with_head?: number;
  head_detections?: number;
  names?: {
    [k: string]: string;
  };
  /**
   * Which classes fed the solver: none | heads | sticks | both.
   */
  inject?: string;
  classes?: {
    [k: string]: string;
  };
  boxes?: RawBoxFrame[];
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "rawBoxFrame".
 */
export interface RawBoxFrame {
  f: number;
  d: RawBox[];
}
/**
 * One detection exactly as the model emitted it: `c` the class id (0 clubhead, 1 stick), `xy` the box centre, `wh` its size — both normalized — and `p` the model's own confidence.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "rawBox".
 */
export interface RawBox {
  c: number;
  xy: Point;
  wh: Point;
  p: number;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "clubFrame".
 */
export interface ClubFrame {
  f: number;
  /**
   * The shaft as two normalized endpoints, butt first.
   */
  shaft: Point[] | null;
  head: Point | null;
  butt: Point | null;
  conf: number;
  shaft_angle_deg?: number | null;
  blurred?: boolean;
  interp: boolean;
  /**
   * This position came from the learned detector rather than the classical solver.
   */
  from_model?: boolean;
  /**
   * Placed on the ball at Impact from the Address landmark (club.anchor_ball), NOT found in this frame. A third provenance on purpose — never the same thing as a detection.
   */
  from_ball?: boolean;
}
/**
 * The drawn club-head path, split by swing segment. NOT one point per frame — only the frames the detector answered — so growing it with the playhead by point count puts the head of the line tens of frames from the club.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "traceSegments".
 */
export interface TraceSegments {
  backswing: Point[];
  downswing: Point[];
  followthrough: Point[];
}
/**
 * The frame each trace point was measured on, parallel to `trace`. Absent before schema 6. It is also what tells the renderer which spans were bridged (a frame step > 2) and must be drawn as unmeasured — the trace never interpolates across a gap.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "traceFrames".
 */
export interface TraceFrames {
  backswing: number[];
  downswing: number[];
  followthrough: number[];
}
/**
 * An alternative club solution over the same frames and the same detections. RENDER-ONLY: metrics, face and event refinement all read the primary block. Present so the player can switch without re-running the analyzer, because there is no ground-truth position metric yet to pick a winner.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "clubVariant".
 */
export interface ClubVariant {
  label: string;
  coverage: ClubCoverage;
  club_len: number;
  butt_len: number;
  notes: string[];
  frames: ClubFrame[];
  trace: TraceSegments;
  trace_frames?: TraceFrames | null;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "face".
 */
export interface Face {
  checkpoints: {
    [k: string]: FaceCheckpoint;
  };
  frames: FaceFrame[];
  /**
   * What video can and cannot say about the face. Shown to the golfer rather than quietly implied.
   */
  capability_note: string;
}
/**
 * A CLASSIFICATION (square/open/closed), or the reason one is not measurable. Never a degree.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "faceCheckpoint".
 */
export interface FaceCheckpoint {
  class: string;
  conf: number;
  reason?: string;
  head_to_shaft_deg?: number;
  deviation_deg?: number;
  n_frames?: number;
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "faceFrame".
 */
export interface FaceFrame {
  f: number;
  head_axis_deg: number | null;
  to_shaft_deg: number | null;
  conf: number;
}
/**
 * Stage 6 metrics. Keypoints are anatomical (`left_wrist`); metrics are lead/trail (`lead_knee_flex`).
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "metrics".
 */
export interface Metrics {
  body_height_norm: number;
  units: string;
  provisional_thresholds: boolean;
  /**
   * Standard coaching terms mapped onto the fields above — see docs/GLOSSARY.md.
   */
  glossary: OpenMap | null;
  sides: Sides | null;
  series: MetricValues[];
  event_snapshots: {
    [k: string]: MetricValues;
  };
  checkpoints?: MetricCheckpoint[] | null;
  checkpoint_notes?: string[] | null;
  angle_fields?: AngleField[] | null;
  summary: {
    [k: string]: number | string | null;
  };
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "openMap".
 */
export interface OpenMap {
  [k: string]: unknown;
}
/**
 * Resolved handedness → lead/trail mapping, so no consumer re-derives it. Lead is the side nearest the TARGET, never the side facing the camera.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "sides".
 */
export interface Sides {
  handedness: string;
  lead: string;
  trail: string;
  note: string;
}
/**
 * One frame or checkpoint's angle values. Null means NOT MEASURABLE IN THIS VIEW, never zero.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "metricValues".
 */
export interface MetricValues {
  [k: string]: number | string | boolean | null;
}
/**
 * The swing indexed by the ten coaching positions rather than the eight events, with every angle at each and its change from address. This is what the angle table renders; `event_snapshots` stays for consumers keyed to the GolfDB names.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "metricCheckpoint".
 */
export interface MetricCheckpoint {
  p: string;
  id: string;
  label: string;
  phase: "setup" | "backswing" | "downswing" | "impact" | "follow_through" | "finish";
  event: string | null;
  frame: number;
  conf: number;
  basis: string;
  definition: string;
  values: MetricValues;
  delta_from_address: {
    [k: string]: number;
  };
}
/**
 * One row of the angle catalogue, emitted by the analyzer so the table is data-driven and the field list is never duplicated client-side.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "angleField".
 */
export interface AngleField {
  field: string;
  label: string;
  /**
   * The view this number means what its name says in. Computed but misleading elsewhere — every 2D joint angle is projection-sensitive.
   */
  view: "both" | "dtl" | "face_on";
  /**
   * False where the field is already measured against address.
   */
  delta: boolean;
  /**
   * `setup` fields are only interpretable at P1 — arm hang at the top is meaningless.
   */
  when: "setup" | "swing" | "both";
  /**
   * Null where the angle has no drawable geometry — the width-derived rotation estimates.
   */
  geom: AngleGeom | null;
}
/**
 * Where an angle lives on the body, so a client can draw it over the video. Every kind is a vertex plus two rays; they differ only in what the second ray is — another bone (`interior`), straight up (`vertical`), straight down (`plumb`), or along +x (`horizontal`, which is what the stack and tilt angles are measured from).
 *
 * `supplement` marks a `_flex` field, whose arc opens from the bone's continuation through the joint because the number is departure from straight. `vectors` is for wrist hinge alone: forearm and shaft share no endpoint, so no single vertex would be honest.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "angleGeom".
 */
export interface AngleGeom {
  kind: "interior" | "vertical" | "plumb" | "horizontal" | "vectors";
  vertex?: PointExpr;
  a?: PointExpr;
  b?: PointExpr;
  supplement?: boolean;
  from?: PointExpr;
  to?: PointExpr;
  guide?: "plumb";
  at?: PointExpr;
  u?: PointPair;
  v?: PointPair;
}
export interface PointChain {
  chain: string[];
  src?: string;
}
export interface PointFeet {
  feet: number;
}
export interface PointClub {
  club: "head";
}
/**
 * Setup reference geometry measured off the golfer's SILHOUETTE, not off keypoints — a coaching line is tangent to the body's outline, which no keypoint knows about. Null before schema 8, and on face-on clips where the rear of the pelvis points at neither edge of frame.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "posture".
 */
export interface Posture {
  butt_line: ButtLine | null;
  /**
   * Why there is no line, when there isn't one — shown rather than silently hiding the control.
   */
  notes: string[];
}
/**
 * The down-the-line posture line: a vertical tangent to the rear of the seat, taken as a median over the address hold and then held for the whole clip. The seat should stay in contact with it through the backswing; leaving it toward the ball is early extension.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "buttLine".
 */
export interface ButtLine {
  /**
   * Normalized x, fixed for every frame — that is the entire point of the drill.
   */
  x: number;
  y0: number;
  y1: number;
  band: NumberPair;
  frame: number;
  frames: FrameRange;
  n: number;
  /**
   * Image direction the seat faces: −1 left of the golfer, +1 right.
   */
  side: -1 | 1;
  /**
   * How much the seat wandered across the address hold, in body heights.
   */
  spread_bh: number;
  conf: number;
  source: string;
}
/**
 * The gate that decides whether an analysis is trustworthy at all. Catastrophically low pose confidence fails the run with a readable reason and filming tips; low club coverage still succeeds, with the trace off and club-dependent checks abstaining.
 *
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "quality".
 */
export interface Quality {
  frames: number;
  detection_coverage: number;
  overall_mean_conf: number;
  per_joint: {
    [k: string]: JointQuality;
  };
}
/**
 * This interface was referenced by `Analysis`'s JSON-Schema
 * via the `definition` "jointQuality".
 */
export interface JointQuality {
  coverage: number;
  mean_conf: number;
}
