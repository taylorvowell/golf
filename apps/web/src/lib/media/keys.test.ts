import { describe, expect, it } from "vitest";
import {
  ARTIFACT_NAMES,
  artifactKey,
  isArtifactName,
  revisionPrefix,
  sourceKey,
  viewPrefix,
  type ViewAddress,
} from "./keys";

const A: ViewAddress = {
  userId: "11111111-1111-4111-8111-111111111111",
  swingId: "22222222-2222-4222-8222-222222222222",
  viewId: "33333333-3333-4333-8333-333333333333",
  revision: 3,
};

describe("artifact addressing", () => {
  it("derives a key from identity alone", () => {
    expect(artifactKey(A, "analysis.json")).toBe(
      "u/11111111-1111-4111-8111-111111111111" +
        "/s/22222222-2222-4222-8222-222222222222" +
        "/v/33333333-3333-4333-8333-333333333333" +
        "/r3/analysis.json",
    );
  });

  it("puts the owner first, so a storage policy can express ownership", () => {
    // Supabase Storage policies can only reason about path segments. If the owner ever stops
    // leading the key, `storage.foldername(name)[2] = auth.uid()` stops meaning anything and the
    // storage-side half of the authorization boundary silently becomes unwritable.
    expect(viewPrefix(A).split("/").slice(0, 2)).toEqual(["u", A.userId]);
  });

  it("separates revisions, so a re-analysis cannot overwrite what a session is reading", () => {
    const next = artifactKey({ ...A, revision: A.revision + 1 }, "normalized.mp4");
    expect(next).not.toBe(artifactKey(A, "normalized.mp4"));
    expect(next.startsWith(viewPrefix(A))).toBe(true);
  });

  it("keeps the source outside the revision prefix", () => {
    // Re-analysing produces new artifacts from the SAME upload. A source that moved with the
    // revision would be copied for nothing and D29's 30-day expiry would have several to chase.
    expect(sourceKey(A, "IMG_4021.mov")).toBe(`${viewPrefix(A)}/source/IMG_4021.mov`);
    expect(sourceKey(A, "IMG_4021.mov").includes("/r")).toBe(false);
  });

  it("is stable across calls — the whole point of deriving rather than storing", () => {
    expect(artifactKey(A, "analysis.json")).toBe(artifactKey({ ...A }, "analysis.json"));
  });

  it("normalizes id case so one view cannot own two prefixes", () => {
    expect(viewPrefix({ ...A, userId: A.userId.toUpperCase() })).toBe(viewPrefix(A));
  });

  describe("rejects anything that could escape its prefix", () => {
    it.each([
      ["a path segment", "../../etc"],
      ["an empty id", ""],
      ["a folder name, which is what this replaced", "6iron-1"],
      ["a truncated uuid", "11111111-1111-4111-8111"],
    ])("%s", (_label, bad) => {
      expect(() => viewPrefix({ ...A, userId: bad })).toThrow();
      expect(() => viewPrefix({ ...A, swingId: bad })).toThrow();
      expect(() => viewPrefix({ ...A, viewId: bad })).toThrow();
    });

    it.each([0, -1, 1.5, NaN])("revision %s", (bad) => {
      expect(() => revisionPrefix({ ...A, revision: bad })).toThrow();
    });

    it.each(["../escape.mov", "a/b.mov", ""])("source filename %s", (bad) => {
      expect(() => sourceKey(A, bad)).toThrow();
    });
  });

  it("carries every artifact docs/CURRENT-STATE.md §3 lists per swing", () => {
    // The publish step iterates this list, so anything missing from it is silently never
    // published — it would not fail, the artifact would just never appear over the network.
    for (const name of [
      "analysis.json", "coach_report.json", "silhouette.json", "isolation.json",
      "source_timing.json", "club_only.json", "normalized.mp4", "analysis.mp4",
      "overlay.mp4", "contact.jpg",
    ]) {
      expect(isArtifactName(name), `${name} is not in the artifact catalogue`).toBe(true);
    }
    expect(ARTIFACT_NAMES.length).toBeGreaterThanOrEqual(10);
  });
});
