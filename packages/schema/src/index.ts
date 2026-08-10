import Ajv, { type ErrorObject } from "ajv";
import analysisSchema from "../schemas/analysis.schema.json" with { type: "json" };
import type { Analysis } from "./generated/analysis.js";

export type { Analysis } from "./generated/analysis.js";
export { analysisSchema };

/**
 * One contract, three consumers: a Python producer and two TypeScript clients.
 *
 * The schema is the source of truth and `src/generated/` is derived from it — never edit the
 * generated file. `pnpm --filter @swingsage/schema check` fails if the two drift, which is what
 * stops a hand-edit quietly becoming the real contract.
 *
 * Validation matters more here than in most projects: a native app cannot be force-updated, so
 * a contract break that reaches a device is not hotfixable. Catching it at analysis time, on the
 * producing side, is the only cheap place to catch it.
 */

const ajv = new Ajv({ allErrors: true, strict: false });
const validateAnalysis = ajv.compile(analysisSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Human-readable one-liners rather than raw Ajv objects — these end up in CI output. */
function format(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

export function validate(data: unknown): ValidationResult {
  const valid = validateAnalysis(data) as boolean;
  return { valid, errors: valid ? [] : format(validateAnalysis.errors) };
}

/** Narrows on success; throws with every problem listed, not just the first. */
export function assertAnalysis(data: unknown): asserts data is Analysis {
  const { valid, errors } = validate(data);
  if (!valid) {
    throw new Error(`analysis.json failed schema validation:\n  ${errors.join("\n  ")}`);
  }
}

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
  const t = a.tempo as { implausible?: unknown[] } | undefined;
  return Array.isArray(t?.implausible) && t.implausible.length > 0;
}
