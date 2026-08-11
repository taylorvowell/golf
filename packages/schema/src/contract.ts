/**
 * The contract with NO validator attached — every generated type, plus the handful of rules that
 * JSON Schema cannot express, plus version negotiation.
 *
 * This is the entry point both clients import (`@swingsage/schema/contract`). It deliberately
 * pulls in neither Ajv nor a JSON import: the types erase to nothing, the helpers are a few
 * lines of arithmetic, and a phone has no business shipping a schema compiler to read an
 * artifact a server already validated. `@swingsage/schema` (the root) adds the validators, and
 * is for the producing side and the test suites.
 *
 * Relative imports here are EXTENSIONLESS on purpose. This package ships TypeScript source, so
 * every consumer resolves it with its own bundler — and a `./versioning.js` specifier resolves
 * to nothing in both Turbopack and Metro, which look for the literal file rather than mapping
 * `.js` back to `.ts`. It fails at request time in the proxy, not at typecheck.
 */
export type * from "./generated/analysis";
export type * from "./generated/api";
export type * from "./generated/coach-report";
export type * from "./generated/silhouette";

export {
  API_VERSIONS,
  CLIENT_VERSION_HEADER,
  CURRENT_API_VERSION,
  CURRENT_ARTIFACT_SCHEMA,
  MINIMUM_ARTIFACT_SCHEMA,
  compareVersions,
  isClientTooOld,
} from "./versioning";

import type { Analysis } from "./generated/analysis";

/** The eight GolfDB events, in the order the contract requires them to occur. */
export const EVENT_ORDER = [
  "address",
  "toe_up",
  "mid_backswing",
  "top",
  "mid_downswing",
  "impact",
  "mid_follow_through",
  "finish",
] as const;

export type EventName = (typeof EVENT_ORDER)[number];

/**
 * Strict event ordering is an invariant the analyzer's own test suite enforces, but it cannot
 * be expressed in JSON Schema — so it lives here, where both clients can apply the same check
 * to an artifact they did not produce.
 */
export function eventsAreOrdered(a: Analysis): boolean {
  const e = a.events as Record<string, { frame: number }> | undefined;
  if (!e) return false;
  let last = -1;
  for (const name of EVENT_ORDER) {
    const f = e[name]?.frame;
    if (typeof f !== "number" || f < last) return false;
    last = f;
  }
  return true;
}

/**
 * True when the pipeline is flagging its own tempo as untrustworthy.
 *
 * Clients must surface this rather than printing the ratio as fact — `7wood-1` reports 53.5:1
 * with three self-reported implausibilities, and a UI that ignored them would present a broken
 * detection as a measurement.
 */
export function tempoIsFlagged(a: Analysis): boolean {
  const t = a.tempo as { implausible?: unknown[] } | null | undefined;
  return Array.isArray(t?.implausible) && t.implausible.length > 0;
}

/**
 * What a stored analysis is missing relative to what a client can render.
 *
 * Checked by CAPABILITY, not version arithmetic. An artifact can legitimately carry a new schema
 * number while lacking an optional block (a swing analysed without `--club-detector` has no
 * detector data no matter how new it is), and an old artifact can be perfectly usable. Asking
 * "what can't I show?" is the question with a useful answer — and it is the answer that lets a
 * client explain a missing control instead of hiding it, which is indistinguishable from broken.
 */
export function missingCapabilities(a: Analysis): string[] {
  const missing: string[] = [];
  // Checked before the club early-return: these come from pose and exist on a --no-club run.
  if (!a.checkpoints?.length) missing.push("the ten swing checkpoints (P1–P10)");
  if (!a.metrics?.checkpoints?.length) missing.push("angles at each checkpoint");
  // Geometry is what makes an angle selectable; without it the table renders but nothing can be
  // drawn on the video, which is the "controls that look broken" case this list exists for.
  else if (!a.metrics.angle_fields?.some((f) => f.geom)) missing.push("angle overlays");
  if (!a.club) return missing; // club tracking was skipped outright; not a staleness issue
  if (!a.club.detector?.boxes?.length) missing.push("raw club-detector output");
  if (!a.club.variants || !Object.keys(a.club.variants).length) {
    missing.push("alternative club solutions");
  }
  return missing;
}
