import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { breakingChanges, schemaSignature, type Signature } from "./shape";

/**
 * The additive-only rule, enforced rather than remembered.
 *
 * `schemas/shape-lock.json` is the committed signature of every contract. This test rebuilds it
 * from the schemas as they stand and fails on any change that would break a client already in
 * someone's hands — see `shape.ts` for the five things that count.
 *
 * To re-lock after a deliberate ADDITION:
 *
 *     pnpm --filter @swingsage/schema lock
 *
 * which rewrites the file and then fails the run on purpose, the same way
 * `pytest --update-golden` does in the analyzer. Updating a lock is the moment you decide the
 * new shape is right, so it must not be possible to do it without looking at the diff.
 */

const SCHEMA_DIR = join(process.cwd(), "schemas");
const LOCK = join(SCHEMA_DIR, "shape-lock.json");
const UPDATING = process.env.UPDATE_SHAPE_LOCK === "1";

function currentSignature(): Signature {
  const out: Signature = {};
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json")).sort()) {
    const name = file.replace(/\.schema\.json$/, "");
    Object.assign(out, schemaSignature(name, JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8"))));
  }
  return out;
}

describe("the contract evolves additively", () => {
  const current = currentSignature();

  if (UPDATING || !existsSync(LOCK)) {
    it("rewrote shape-lock.json — review the diff, then re-run without UPDATE_SHAPE_LOCK", () => {
      writeFileSync(LOCK, `${JSON.stringify(sorted(current), null, 2)}\n`);
      expect.fail(
        `shape-lock.json rewritten with ${Object.keys(current).length} entries. ` +
          "Read the diff: every removal or retype in it is a break for a client already shipped.",
      );
    });
    return;
  }

  const locked: Signature = JSON.parse(readFileSync(LOCK, "utf8"));

  it("breaks nothing that a shipped client depends on", () => {
    expect(breakingChanges(locked, current)).toEqual([]);
  });

  it("locks every contract in schemas/", () => {
    for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"))) {
      const name = file.replace(/\.schema\.json$/, "");
      expect(Object.keys(locked).some((k) => k.startsWith(`${name}#`))).toBe(true);
    }
  });

  it("has a lock entry for every node currently in the schemas", () => {
    const unlocked = Object.keys(current).filter((k) => !(k in locked));
    expect(
      unlocked,
      "new schema nodes are fine — run `pnpm --filter @swingsage/schema lock` to record them",
    ).toEqual([]);
  });
});

describe("breakingChanges catches each kind of break", () => {
  const base: Signature = {
    "a#/properties/x": { type: "string" },
    "a#": { type: "object", required: ["x"] },
    "a#/properties/v": { type: "string", enum: ['"dtl"', '"face_on"'] },
    "a#/properties/r": { ref: "#/definitions/one" },
  };

  it("passes an unchanged signature", () => {
    expect(breakingChanges(base, base)).toEqual([]);
  });

  it("allows a brand-new field", () => {
    expect(breakingChanges(base, { ...base, "a#/properties/y": { type: "number" } })).toEqual([]);
  });

  it("allows a new enum member", () => {
    const wider = { ...base, "a#/properties/v": { type: "string", enum: ['"dtl"', '"face_on"', '"overhead"'] } };
    expect(breakingChanges(base, wider)).toEqual([]);
  });

  it("allows required to relax", () => {
    expect(breakingChanges(base, { ...base, "a#": { type: "object", required: [] } })).toEqual([]);
  });

  it("catches a removed node", () => {
    const { "a#/properties/x": _gone, ...rest } = base;
    expect(breakingChanges(base, rest)[0]).toMatch(/was REMOVED/);
  });

  it("catches a retyped node", () => {
    expect(
      breakingChanges(base, { ...base, "a#/properties/x": { type: "number" } })[0],
    ).toMatch(/changed type/);
  });

  it("catches a repointed $ref", () => {
    expect(
      breakingChanges(base, { ...base, "a#/properties/r": { ref: "#/definitions/two" } })[0],
    ).toMatch(/changed \$ref/);
  });

  it("catches a newly required field", () => {
    expect(
      breakingChanges(base, { ...base, "a#": { type: "object", required: ["x", "y"] } })[0],
    ).toMatch(/newly REQUIRES y/);
  });

  it("catches a dropped enum member", () => {
    expect(
      breakingChanges(base, { ...base, "a#/properties/v": { type: "string", enum: ['"dtl"'] } })[0],
    ).toMatch(/dropped enum value/);
  });
});

/** Stable key order so a re-lock produces a readable diff rather than a reshuffle. */
function sorted(sig: Signature): Signature {
  return Object.fromEntries(Object.entries(sig).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
