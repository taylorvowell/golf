import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import analysisSchema from "../schemas/analysis.schema.json" with { type: "json" };
import apiSchema from "../schemas/api.schema.json" with { type: "json" };
import coachReportSchema from "../schemas/coach-report.schema.json" with { type: "json" };
import silhouetteSchema from "../schemas/silhouette.schema.json" with { type: "json" };
import sourceManifestSchema from "../schemas/source-manifest.schema.json" with { type: "json" };
import type { Analysis } from "./generated/analysis";
import type { CoachReport } from "./generated/coach-report";
import type { Silhouette } from "./generated/silhouette";
import type { SourceManifest } from "./generated/source-manifest";

/**
 * One contract, three consumers: a Python producer and two TypeScript clients.
 *
 * The schemas are the source of truth and `src/generated/` is derived from them — never edit a
 * generated file. `pnpm --filter @swingsage/schema check` fails if the two drift, which is what
 * stops a hand-edit quietly becoming the real contract.
 *
 * Validation matters more here than in most projects: a native app cannot be force-updated, so a
 * contract break that reaches a device is not hotfixable. Catching it at analysis time, on the
 * producing side, is the only cheap place to catch it — `swingsage/contract.py` runs these same
 * schema files against the same artifacts before they are written.
 *
 * This entry point carries Ajv. Clients import `@swingsage/schema/contract` instead, which is
 * the same types and rules with no validator attached.
 */

export * from "./contract";
export { breakingChanges, schemaSignature } from "./shape";
export type { ShapeEntry, Signature } from "./shape";
export { analysisSchema, apiSchema, coachReportSchema, silhouetteSchema, sourceManifestSchema };

/**
 * `strict: false` because the schemas carry prose the strict meta-schema objects to, and
 * `allErrors` because a contract break is usually several fields at once — reporting only the
 * first turns one fix into several round trips.
 */
const ajv = new Ajv({ allErrors: true, strict: false });

const validateAnalysisFn = ajv.compile(analysisSchema);
const validateCoachReportFn = ajv.compile(coachReportSchema);
const validateSilhouetteFn = ajv.compile(silhouetteSchema);
const validateSourceManifestFn = ajv.compile(sourceManifestSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Human-readable one-liners rather than raw Ajv objects — these end up in CI output. */
function format(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

function run(fn: ValidateFunction, data: unknown): ValidationResult {
  const valid = fn(data) as boolean;
  return { valid, errors: valid ? [] : format(fn.errors) };
}

export const validate = (data: unknown): ValidationResult => run(validateAnalysisFn, data);
export const validateCoachReport = (data: unknown): ValidationResult =>
  run(validateCoachReportFn, data);
export const validateSilhouette = (data: unknown): ValidationResult =>
  run(validateSilhouetteFn, data);
export const validateSourceManifest = (data: unknown): ValidationResult =>
  run(validateSourceManifestFn, data);

function assertWith(label: string, result: ValidationResult): void {
  if (!result.valid) {
    throw new Error(`${label} failed schema validation:\n  ${result.errors.join("\n  ")}`);
  }
}

/** Narrows on success; throws with every problem listed, not just the first. */
export function assertAnalysis(data: unknown): asserts data is Analysis {
  assertWith("analysis.json", validate(data));
}

export function assertCoachReport(data: unknown): asserts data is CoachReport {
  assertWith("coach_report.json", validateCoachReport(data));
}

export function assertSilhouette(data: unknown): asserts data is Silhouette {
  assertWith("silhouette.json", validateSilhouette(data));
}

export function assertSourceManifest(data: unknown): asserts data is SourceManifest {
  assertWith("source_manifest.json", validateSourceManifest(data));
}
