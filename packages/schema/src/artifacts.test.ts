import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCoachReport,
  validateCoachReport,
  validateSilhouette,
} from "./index";

/**
 * The other two artifacts the analyzer writes, held to the same standard as `analysis.json`:
 * validated against every real file on disk, not only against examples the schema was written
 * from. Falls back to synthetic cases where `out/` is absent (it is gitignored, so CI has none).
 */

const OUT_DIR = join(process.cwd(), "..", "..", "services", "analyzer", "out");

function artifacts(name: string): { stem: string; data: unknown }[] {
  if (!existsSync(OUT_DIR)) return [];
  return readdirSync(OUT_DIR)
    .map((stem) => ({ stem, path: join(OUT_DIR, stem, name) }))
    .filter((x) => existsSync(x.path))
    .map((x) => ({ stem: x.stem, data: JSON.parse(readFileSync(x.path, "utf8")) }));
}

const reports = artifacts("coach_report.json");
const silhouettes = artifacts("silhouette.json");

/** Every block Stage 8 has always written, and nothing more. */
const minimalReport = (): Record<string, unknown> => ({
  scoring_model_version: "v2",
  club_type: "irons",
  view: "dtl",
  overall: 70,
  band: "Solid",
  arc_shift: null,
  coverage: { scored: 1, skipped_this_swing: 0, deferred_in_config: 0, total_checks: 1 },
  categories: {},
  checkpoints: {},
  findings: [],
  priorities: [],
  primary: { id: null, checkpoint: null, title: "", copy: "", moment: "", score: 0, leverage: 0 },
  drill: { title: "", copy: "", dose: "", doseNote: "" },
});

describe("coach_report.json on disk", () => {
  for (const { stem, data } of reports) {
    it(`${stem} validates`, () => {
      expect(validateCoachReport(data).errors).toEqual([]);
    });
  }

  it("rejects a report with no scoring_model_version — an unreproducible score", () => {
    const bad = minimalReport();
    delete bad.scoring_model_version;
    expect(validateCoachReport(bad).valid).toBe(false);
  });

  it("accepts the minimal report", () => {
    expect(validateCoachReport(minimalReport()).errors).toEqual([]);
  });

  it("rejects a coverage block missing a bucket", () => {
    const bad = { ...minimalReport(), coverage: { scored: 3, total_checks: 5 } };
    expect(validateCoachReport(bad).valid).toBe(false);
  });

  it("accepts overall: null — nothing measurable is a legitimate answer", () => {
    const abstaining = {
      ...minimalReport(),
      club_type: null,
      view: "face_on",
      overall: null,
      band: null,
      coverage: { scored: 0, skipped_this_swing: 28, deferred_in_config: 10, total_checks: 38 },
    };
    expect(validateCoachReport(abstaining).errors).toEqual([]);
  });

  it("rejects a club_type the scoring config has no bands for", () => {
    expect(validateCoachReport({ ...minimalReport(), club_type: "wedge" }).valid).toBe(false);
  });

  it("assertCoachReport names the artifact in its error", () => {
    expect(() => assertCoachReport({})).toThrow(/coach_report\.json failed schema validation/);
  });
});

describe("silhouette.json on disk", () => {
  for (const { stem, data } of silhouettes) {
    it(`${stem} validates`, () => {
      expect(validateSilhouette(data).errors).toEqual([]);
    });
  }

  const minimal = () => ({
    schema: 1,
    source: "sam2",
    model: "sam2.1_s.pt",
    eps: 1.5,
    width: 1080,
    height: 1920,
    frame_count: 1,
    coverage: 1,
    notes: [],
    frames: [{ f: 0, p: [[[0.1, 0.2], [0.3, 0.4]]] }],
  });

  it("accepts a minimal outline", () => {
    expect(validateSilhouette(minimal()).errors).toEqual([]);
  });

  it("rejects a ring point that is not a pair", () => {
    const bad = minimal();
    bad.frames[0].p = [[[0.1, 0.2, 0.3]]] as unknown as number[][][];
    expect(validateSilhouette(bad).valid).toBe(false);
  });

  it("rejects a frame with no rings array at all", () => {
    const bad = { ...minimal(), frames: [{ f: 0 }] };
    expect(validateSilhouette(bad).valid).toBe(false);
  });
});
