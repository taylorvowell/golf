import * as FileSystem from "expo-file-system/legacy";
import type { Job, JobStatusResponse } from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import type { CaptureView, SwingClipRef } from "./sessionState";

/**
 * A recorded swing's journey from a file on the phone to an analysed swing on the server.
 *
 * **Module-level, not screen-level, and that is the whole design.** The golfer records, walks
 * back to the ball and hits again — the post-swing screen they started the upload on is gone
 * long before the analyzer finishes. A hook that owned this state would abort every upload the
 * moment they moved, so the state lives here and screens subscribe to it. Leaving session mode
 * entirely does not stop it either; the pipeline is the session's, not any screen's.
 *
 * **The transport is deliberately dumb.** One `PUT` of the whole trimmed clip, no resumability,
 * no background survival, no wifi policy — `media-pipeline` owns those and replaces
 * `uploadSwingVideo` below without touching anything else here, because the two-phase ingest
 * (`POST /swings` → send bytes to the target you were given → `POST /source/complete`) has no
 * opinion about how the bytes travel. That seam is the point; the shortfalls are named in this
 * track's `_PROGRESS.md`.
 *
 * **Nothing here claims progress it cannot see.** The stage shown is the stage the job row
 * reports. A queue nobody is draining reads "Queued" forever rather than creeping toward 90%,
 * because a fake percentage is a lie a golfer will believe once and never again.
 */

/** What the analyzing bar is told. Mirrors the job's own states plus the upload that precedes it. */
export type ProcessingPhase = "uploading" | "queued" | "running" | "done" | "failed";

export interface ProcessingState {
  phase: ProcessingPhase;
  /** The label under the bar — a golfer's words for the stage the job reports. */
  stage: string;
  /** Which segment of `ANALYSIS_STAGES` is lit. Never interpolated between stages. */
  stageIndex: number;
  /** The job's own percent, 0–100 — reported by the pipeline, never derived from a clock. */
  progressPct: number;
  /** The job's own fine-grained line ("frame 2256 of 2445"). Empty until the run says one. */
  detail: string;
  /** The server's swing id, once phase one answered. Null until then. */
  swingId: string | null;
  viewId: string | null;
  /** Why it failed, in the analyzer's own words. Null unless `phase === "failed"`. */
  message: string | null;
  /**
   * Whether the clip actually reached the server and an analysis was started.
   *
   * It decides what a failure MEANS. False and the swing row is empty — the bytes never landed,
   * there is nothing to watch, and the row is litter to be cleaned up. True and the golfer has a
   * video on the server that simply has no analysis yet, which is theirs to keep.
   */
  analysisStarted: boolean;
}

/**
 * The stages a golfer sees, in order. The analyzer's own stage strings are mapped onto these —
 * a pipeline that grows a stage does not grow a segment here until someone decides it is worth
 * a golfer's attention.
 */
export const ANALYSIS_STAGES = [
  "Uploading",
  "Queued",
  "Analyzing pose",
  "Tracking club",
  "Rendering",
  "Scoring",
] as const;

/**
 * The analyzer's stage names → the segment to light.
 *
 * Matched on a lowercase substring rather than equality: stage strings come from the Python
 * pipeline's own logging and have changed shape before. An unrecognised stage keeps the last
 * segment it reached instead of snapping backwards, which is what an unknown stage deserves —
 * the run is demonstrably past the previous one.
 */
const STAGE_HINTS: Array<{ match: string; index: number }> = [
  { match: "normalize", index: 1 },
  { match: "pose", index: 2 },
  { match: "club", index: 3 },
  { match: "trace", index: 3 },
  { match: "silhouette", index: 3 },
  { match: "render", index: 4 },
  { match: "score", index: 5 },
  { match: "scoring", index: 5 },
];

function stageIndexFor(job: Job, previous: number): number {
  if (job.status === "queued") return 1;
  const stage = (job.stage ?? "").toLowerCase();
  for (const hint of STAGE_HINTS) {
    if (stage.includes(hint.match)) return Math.max(previous, hint.index);
  }
  // Running, but the stage is not one we name: it is at least past Queued.
  return Math.max(previous, 2);
}

function stageLabelFor(job: Job, index: number): string {
  return job.status === "queued" ? "Queued" : ANALYSIS_STAGES[index];
}

// ---- the store ---------------------------------------------------------------------------

const states = new Map<string, ProcessingState>();
const listeners = new Map<string, Set<() => void>>();
/** Local swing ids whose pipeline is already running — `start` is idempotent per swing. */
const running = new Set<string>();

function emit(localId: string, next: ProcessingState): void {
  states.set(localId, next);
  for (const listener of listeners.get(localId) ?? []) listener();
}

export function getProcessing(localId: string): ProcessingState | null {
  return states.get(localId) ?? null;
}

export function subscribeProcessing(localId: string, listener: () => void): () => void {
  const set = listeners.get(localId) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(localId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(localId);
  };
}

/** Sign-out, and the tests' reset seam. A pipeline outliving its account is a leak. */
export function clearProcessing(): void {
  states.clear();
  listeners.clear();
  running.clear();
}

// ---- the pipeline ------------------------------------------------------------------------

export interface ProcessingInput {
  clip: SwingClipRef;
  view: CaptureView;
  handedness: "right" | "left";
  /** Null when the session row has not been minted yet — the swing simply carries no session. */
  sessionId: string | null;
  /**
   * Whether to enqueue the analyzer. False for a video-only session, and for a swing recorded
   * with AI analysis switched off — the clip is still uploaded, because skipping ingest would
   * leave the only copy of the swing in a cache the app sweeps.
   */
  analyze: boolean;
}

/** Everything this app records is an MP4; the server accepts mp4 and mov only. */
const CONTENT_TYPE = "video/mp4";

/** Polled fast at first — most of a 6-second clip's analysis is over inside a minute. */
const POLL_MIN_MS = 1_200;
const POLL_MAX_MS = 5_000;
/**
 * A run that has said nothing for this long is treated as lost rather than shown forever. The
 * server's own orphan sweep is the authority; this is the client refusing to spin past the point
 * a golfer would have given up.
 */
const POLL_GIVE_UP_MS = 12 * 60 * 1000;

interface CreatedCapture {
  swingId: string;
  viewId: string;
  upload: { url: string; method: string; headers: Record<string, string> };
  /** Where the poster frame goes. Optional so a server predating it changes nothing here. */
  posterUpload?: { url: string; method: string; headers: Record<string, string> };
  /** Where `source_manifest.json` goes. Optional for the same version-skew reason. */
  manifestUpload?: { url: string; method: string; headers: Record<string, string> };
}

/** Poster decode width — card-and-cover sized, a few tens of KB as JPEG. */
const POSTER_PX = 720;

/**
 * The poster's sample points, in FILE seconds.
 *
 * The moments are chosen in REAL seconds — the golfer at address lives in the first ~1.5s of
 * the trimmed swing — and scaled onto the clip's own clock. On a slow-mo import one real
 * second is `slowMoFactor` file seconds; unscaled, all three chances collapsed onto the first
 * fifth of a real second (audit, 2026-08-26). Pure and exported so the arithmetic is pinned
 * without driving the upload pipeline.
 */
export function posterSampleTimes(slowMoFactor = 1): number[] {
  const factor = Math.max(1, slowMoFactor);
  return [0.05, 0.5, 1.5].map((t) => t * factor);
}

/**
 * Extract one frame of the clip — the golfer at address — and send it to the poster target.
 *
 * Fired alongside the video upload, not before it: the JPEG is tens of kilobytes and lands in
 * under a second, which is what puts a picture on the swing's log row the moment it exists
 * instead of minutes later when the analyzer renders `contact.jpg` (Taylor, 2026-08-26).
 * Best-effort in every direction — a swing must never fail, stall, or even warn a golfer
 * because its THUMBNAIL didn't make it. Loud in dev only.
 */
async function uploadPoster(
  target: NonNullable<CreatedCapture["posterUpload"]>,
  clipPath: string,
  slowMoFactor = 1,
): Promise<void> {
  try {
    const { default: HighSpeedCamera } = await import("../../../modules/high-speed-camera/src");
    if (typeof HighSpeedCamera?.clipThumbnailsAt !== "function") return;
    // Three early sample points, first hit wins — the extractor answers with the nearest sync
    // frame and skips misses, so one request is one chance (pendingImports' lesson). All
    // three sit at the front of the clip, which the trim put at the golfer's address; see
    // `posterSampleTimes` for the slow-mo clock scaling.
    const frames = await HighSpeedCamera.clipThumbnailsAt(
      clipPath.replace(/^file:\/\//, ""),
      posterSampleTimes(slowMoFactor),
      POSTER_PX,
    );
    const frame = frames?.[0]?.path;
    if (!frame) return;
    const { url, headers } = await api.uploadTarget(target.url, target.headers);
    const result = await FileSystem.uploadAsync(url, toFileUri(frame), {
      httpMethod: target.method === "POST" ? "POST" : "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    });
    if (__DEV__ && (result.status < 200 || result.status >= 300)) {
      console.warn(`poster upload refused ${result.status}`);
    }
  } catch (err) {
    if (__DEV__) console.warn("poster upload failed", err);
  }
}

/**
 * Send the bytes to wherever phase one said.
 *
 * The target is either a signed storage URL (absolute, no auth of ours) or this server's own
 * upload route (relative, needs the bearer token). The client must not branch on which — it
 * sends the file exactly as described — so the only thing decided here is that a relative URL
 * gets resolved and authorized, which is a property of the URL, not of the storage driver.
 */
async function uploadSwingVideo(
  upload: CreatedCapture["upload"],
  clipPath: string,
): Promise<void> {
  const { url, headers } = await api.uploadTarget(upload.url, upload.headers);

  /**
   * Statuses worth sending the bytes again for. Everything else in 4xx is a statement about
   * the request — a wrong content type, an expired signature — and repeating it changes
   * nothing except how long the golfer waits to hear that.
   */
  const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 507, 509]);
  const ATTEMPTS = 3;

  let result: FileSystem.FileSystemUploadResult | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential, and deliberately short: a phone on a range's edge-of-signal wifi drops
      // one request and recovers, which is the case this is for. A real outage is the
      // pipeline's problem, not something to hold a golfer's screen open through.
      await sleep(1500 * 2 ** (attempt - 1));
    }
    try {
      result = await FileSystem.uploadAsync(url, toFileUri(clipPath), {
        httpMethod: upload.method === "POST" ? "POST" : "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers,
      });
    } catch (err) {
      // Never reached the far end: DNS, a refused socket, a connection dropped mid-body.
      // Always worth another go — losing a whole swing to one lost packet is the failure
      // this loop exists to prevent.
      lastError = err;
      console.error(`upload attempt ${attempt + 1} failed for ${url.split("?")[0]}:`, err);
      result = null;
      continue;
    }
    if (result.status >= 200 && result.status < 300) return;
    if (!RETRYABLE.has(result.status)) break;
    console.error(`upload attempt ${attempt + 1} got ${result.status}; retrying`);
  }

  if (!result) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`the upload could not be sent (${String(lastError)})`);
  }
  console.error(
    `upload refused ${result.status} from ${url.split("?")[0]}: ${result.body?.slice(0, 300)}`,
  );
  throw new Error(`the upload was refused (${result.status})`);
}

/** The recorder writes bare absolute paths; the file APIs want a scheme. */
function toFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

/**
 * PUT the source manifest to its target — small JSON, sent from memory.
 *
 * Awaited (unlike the poster) because ordering is part of the contract: the manifest must be
 * in place before `source/complete`, which is where the server records whether one exists.
 * Failure is still tolerated — the server accepts manifest-absent uploads by design (older
 * clients forever will be), so a swing must never fail for its metadata. Loud in dev only.
 */
async function uploadManifest(
  target: NonNullable<CreatedCapture["manifestUpload"]>,
  manifest: NonNullable<ProcessingInput["clip"]["manifest"]>,
): Promise<void> {
  try {
    const { url, headers } = await api.uploadTarget(target.url, target.headers);
    const res = await fetch(url, {
      method: target.method === "POST" ? "POST" : "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (__DEV__ && !res.ok) console.warn(`manifest upload refused ${res.status}`);
  } catch (err) {
    if (__DEV__) console.warn("manifest upload failed", err);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run one swing all the way through, updating the store as it goes.
 *
 * Idempotent per swing: a screen remounting must never start a second upload of the same clip,
 * which would mint a second swing row for one hit.
 */
export function startProcessing(localId: string, input: ProcessingInput): void {
  if (running.has(localId)) return;
  running.add(localId);
  void run(localId, input).catch((err: unknown) => {
    // The catch of last resort — `run` already reports every failure it expects.
    emit(localId, {
      ...(states.get(localId) ?? blank()),
      phase: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

function blank(): ProcessingState {
  return {
    phase: "uploading",
    stage: ANALYSIS_STAGES[0],
    stageIndex: 0,
    progressPct: 0,
    detail: "",
    swingId: null,
    viewId: null,
    message: null,
    analysisStarted: false,
  };
}

async function run(localId: string, input: ProcessingInput): Promise<void> {
  let state = blank();
  emit(localId, state);

  let created: CreatedCapture;
  try {
    created = await api.request<CreatedCapture>("swings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: input.view,
        handedness: input.handedness,
        contentType: CONTENT_TYPE,
        sessionId: input.sessionId,
      }),
    });
  } catch (err) {
    return fail(localId, state, err, "We couldn't start uploading this swing.");
  }

  // The swing exists on the server from here on, even if the bytes never arrive — a visible,
  // deletable row rather than an upload with nothing behind it.
  state = { ...state, swingId: created.swingId, viewId: created.viewId };
  emit(localId, state);

  // The poster races the video and wins by minutes — see `uploadPoster`. Never awaited.
  if (created.posterUpload) {
    void uploadPoster(created.posterUpload, input.clip.path, input.clip.slowMoFactor);
  }

  try {
    await uploadSwingVideo(created.upload, input.clip.path);
  } catch (err) {
    return fail(localId, state, err, "The video didn't finish uploading.");
  }

  // The source manifest lands BEFORE `source/complete` — that call is where the server
  // records whether one exists, and the guard reads it on delivery. Awaited but tolerant:
  // see `uploadManifest`.
  if (created.manifestUpload && input.clip.manifest) {
    await uploadManifest(created.manifestUpload, input.clip.manifest);
  }

  let job: JobStatusResponse;
  try {
    job = await api.request<JobStatusResponse>(`swings/${created.swingId}/source/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: CONTENT_TYPE, analyze: input.analyze }),
    });
  } catch (err) {
    return fail(localId, state, err, "The upload landed but analysis wouldn't start.");
  }

  state = { ...state, analysisStarted: true };

  if (!input.analyze || !("id" in job)) {
    // Nothing to wait for: the bytes are stored and no run was asked for. Done means done here,
    // not "done analysing" — the swing is as finished as it was ever going to be.
    running.delete(localId);
    emit(localId, { ...state, phase: "done", stage: "Saved", stageIndex: ANALYSIS_STAGES.length - 1 });
    return;
  }

  state = { ...state, phase: "queued", stage: "Queued", stageIndex: 1 };
  emit(localId, state);

  // ---- poll ------------------------------------------------------------------------------
  const startedAt = Date.now();
  let wait = POLL_MIN_MS;
  for (;;) {
    await sleep(wait);
    // Backs off toward the ceiling: a long run must not cost a request a second for minutes.
    wait = Math.min(POLL_MAX_MS, Math.round(wait * 1.35));

    let polled: JobStatusResponse;
    try {
      polled = await api.request<JobStatusResponse>(
        `swings/${created.swingId}/reanalyze?view=${encodeURIComponent(input.view)}`,
      );
    } catch {
      // A dropped poll is not a failed analysis — the run continues on the server and the next
      // poll asks again. Only the give-up clock ends it.
      if (Date.now() - startedAt > POLL_GIVE_UP_MS) {
        return fail(localId, state, null, "We lost track of this analysis. You can retry it.");
      }
      continue;
    }

    if (!("id" in polled)) {
      // `{ status: "idle" }` — the row is not visible yet. Keep waiting; the job was created.
      if (Date.now() - startedAt > POLL_GIVE_UP_MS) {
        return fail(localId, state, null, "Analysis never started. You can retry it.");
      }
      continue;
    }

    const index = stageIndexFor(polled, state.stageIndex);
    state = {
      ...state,
      phase: polled.status === "done" ? "done" : polled.status === "failed" ? "failed" : polled.status,
      stage: stageLabelFor(polled, index),
      stageIndex: index,
      // The pipeline's own numbers, verbatim — the bar shows what the job reports, never a
      // clock. `message` doubles as the failure sentence, so it is only a DETAIL while running.
      progressPct: polled.progressPct,
      detail: polled.status === "running" ? polled.message : "",
      message: polled.status === "failed" ? polled.message || "The analysis didn't finish." : null,
    };
    emit(localId, state);

    if (polled.status === "done" || polled.status === "failed") {
      running.delete(localId);
      return;
    }

    if (Date.now() - startedAt > POLL_GIVE_UP_MS) {
      return fail(localId, state, null, "This analysis has been running too long.");
    }
  }
}

function fail(localId: string, state: ProcessingState, err: unknown, fallback: string): void {
  running.delete(localId);
  const detail = err instanceof Error ? err.message : null;
  emit(localId, { ...state, phase: "failed", message: detail || fallback });
}

/**
 * Try a failed swing again from wherever it got to.
 *
 * A swing that never created its row starts over; one whose bytes are already on the server only
 * needs the completion call, which re-verifies the object and re-enqueues. Both are safe to call
 * twice — the upload key is derived per view, so there is only ever one object to find.
 */
export function retryProcessing(localId: string, input: ProcessingInput): void {
  running.delete(localId);
  states.delete(localId);
  startProcessing(localId, input);
}
