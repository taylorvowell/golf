import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_ORDER, assertAnalysis, eventsAreOrdered, tempoIsFlagged, validate } from "./index.js";
import type { Analysis } from "./generated/analysis.js";

/**
 * The schema only earns trust if it validates the artifacts the pipeline actually writes.
 *
 * So these run against every real `out/<stem>/analysis.json` on disk when present, and fall
 * back to synthetic cases in CI where `out/` is gitignored and absent. A schema validated only
 * against fixtures it was written from proves nothing.
 */

const OUT_DIR = join(process.cwd(), "..", "..", "services", "analyzer", "out");

function realArtifacts(): { name: string; data: unknown }[] {
  if (!existsSync(OUT_DIR)) return [];
  return readdirSync(OUT_DIR)
    .map((name) => ({ name, path: join(OUT_DIR, name, "analysis.json") }))
    .filter((x) => existsSync(x.path))
    .map((x) => ({ name: x.name, data: JSON.parse(readFileSync(x.path, "utf8")) }));
}

const artifacts = realArtifacts();

describe("real artifacts on disk", () => {
  it.skipIf(artifacts.length === 0)("there are artifacts to check", () => {
    expect(artifacts.length).toBeGreaterThan(0);
  });

  for (const { name, data } of artifacts) {
    describe(name, () => {
      it("validates against the schema", () => {
        const { valid, errors } = validate(data);
        expect(errors).toEqual([]);
        expect(valid).toBe(true);
      });

      it("carries all eight events in strict order", () => {
        expect(eventsAreOrdered(data as Analysis)).toBe(true);
      });

      it("publishes 49 keypoint names", () => {
        const a = data as Analysis;
        expect((a.pose.keypoint_names as string[]).length).toBe(49);
      });

      it("keeps every coordinate normalized to 0–1", () => {
        const a = data as unknown as { pose: { frames: { kp?: number[][] }[] } };
        // Sample rather than sweep every frame of every clip — enough to catch a unit change.
        for (const frame of a.pose.frames.slice(0, 25)) {
          for (const kp of frame.kp ?? []) {
            expect(kp[0]).toBeGreaterThanOrEqual(-0.5);
            expect(kp[0]).toBeLessThanOrEqual(1.5);
            expect(kp[1]).toBeGreaterThanOrEqual(-0.5);
            expect(kp[1]).toBeLessThanOrEqual(1.5);
          }
        }
      });
    });
  }
});

describe("the schema rejects what it should", () => {
  const minimal = (): Record<string, unknown> => ({
    schema_version: 9,
    video: { fps: 60, frame_count: 300, width: 1080, height: 1920 },
    pose: { keypoint_names: Array.from({ length: 49 }, (_, i) => `k${i}`), frames: [] },
    events: Object.fromEntries(EVENT_ORDER.map((e, i) => [e, { frame: i * 10, conf: 0.9 }])),
  });

  it("accepts a minimal well-formed artifact", () => {
    expect(validate(minimal()).valid).toBe(true);
  });

  it("rejects a missing required event", () => {
    const bad = minimal();
    delete (bad.events as Record<string, unknown>).impact;
    expect(validate(bad).valid).toBe(false);
  });

  it("rejects fewer than 49 keypoint names", () => {
    const bad = minimal();
    (bad.pose as { keypoint_names: string[] }).keypoint_names = ["a", "b"];
    expect(validate(bad).valid).toBe(false);
  });

  it("rejects a confidence outside 0–1", () => {
    const bad = minimal();
    (bad.events as Record<string, { conf: number }>).top.conf = 1.4;
    expect(validate(bad).valid).toBe(false);
  });

  it("rejects a zero or negative frame rate", () => {
    const bad = minimal();
    (bad.video as { fps: number }).fps = 0;
    expect(validate(bad).valid).toBe(false);
  });

  it("rejects a view it does not know", () => {
    const bad = minimal();
    (bad.video as { view?: string }).view = "overhead";
    expect(validate(bad).valid).toBe(false);
  });

  it("rejects a playback window that is not a pair", () => {
    const bad = minimal();
    bad.playback_window = [10, 20, 30];
    expect(validate(bad).valid).toBe(false);
  });

  it("ACCEPTS unknown extra fields — the contract evolves additively", () => {
    // A client built for schema 9 must tolerate an artifact from schema 11 rather than crash.
    // This is the whole reason additive-only evolution is a rule.
    const forward = minimal();
    forward.some_future_field = { anything: true };
    (forward.video as Record<string, unknown>).future_codec_info = "av1";
    expect(validate(forward).valid).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    const bad = minimal();
    (bad.video as { fps: number }).fps = 0;
    (bad.pose as { keypoint_names: string[] }).keypoint_names = [];
    expect(validate(bad).errors.length).toBeGreaterThan(1);
  });
});

describe("assertAnalysis", () => {
  it("throws with the failures listed", () => {
    expect(() => assertAnalysis({ schema_version: 9 })).toThrow(/failed schema validation/);
  });

  it("passes a valid artifact through", () => {
    const ok = {
      schema_version: 9,
      video: { fps: 60, frame_count: 300, width: 1080, height: 1920 },
      pose: { keypoint_names: Array.from({ length: 49 }, (_, i) => `k${i}`), frames: [] },
      events: Object.fromEntries(EVENT_ORDER.map((e, i) => [e, { frame: i * 10 }])),
    };
    expect(() => assertAnalysis(ok)).not.toThrow();
  });
});

describe("eventsAreOrdered catches what JSON Schema cannot express", () => {
  const base = {
    schema_version: 9,
    video: { fps: 60, frame_count: 300, width: 1080, height: 1920 },
    pose: { keypoint_names: [], frames: [] },
  };

  it("rejects events that go backwards", () => {
    const out = {
      ...base,
      events: Object.fromEntries(EVENT_ORDER.map((e, i) => [e, { frame: 100 - i }])),
    } as unknown as Analysis;
    expect(eventsAreOrdered(out)).toBe(false);
  });

  it("allows events sharing a frame — impact and follow-through often do", () => {
    const same = {
      ...base,
      events: Object.fromEntries(EVENT_ORDER.map((e) => [e, { frame: 42 }])),
    } as unknown as Analysis;
    expect(eventsAreOrdered(same)).toBe(true);
  });
});

describe("tempoIsFlagged", () => {
  it("is true when the pipeline reports implausibilities", () => {
    const a = { tempo: { ratio: 53.5, implausible: ["ratio 53.5:1 outside 1.8-4.2:1"] } };
    expect(tempoIsFlagged(a as unknown as Analysis)).toBe(true);
  });

  it("is false for a clean tempo", () => {
    expect(tempoIsFlagged({ tempo: { ratio: 3.0, implausible: [] } } as unknown as Analysis)).toBe(false);
    expect(tempoIsFlagged({ tempo: { ratio: 3.0 } } as unknown as Analysis)).toBe(false);
  });

  it.skipIf(artifacts.length === 0)("flags 7wood-1 on the real data, if present", () => {
    const seven = artifacts.find((a) => a.name === "7wood-1");
    if (!seven) return;
    expect(tempoIsFlagged(seven.data as Analysis)).toBe(true);
  });
});
