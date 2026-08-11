import { BONES, MIN_CONF, buildIndex, frameAt, type PoseBundle } from "./pose";

/**
 * The pose contract, asserted on the client side.
 *
 * These are not tests of arithmetic — they are tests of the rules that make an overlay correct,
 * each of which this project has a documented reason to care about. A renderer that quietly
 * violates any of them still draws a plausible skeleton, which is the whole problem.
 */

const bundle = (frames: PoseBundle["frames"]): PoseBundle => ({
  stem: "test",
  fps: 60,
  frameCount: frames.length,
  width: 720,
  height: 1280,
  view: "dtl",
  handedness: "right",
  keypointNames: ["nose", "neck", "left_shoulder"],
  frames,
});

describe("buildIndex", () => {
  it("maps every name to its position", () => {
    expect(buildIndex(["a", "b", "c"])).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("is built from the artifact's own names, so appended joints cannot desync the renderer", () => {
    // The 49-keypoint order is append-only by contract; a renderer that hardcoded indices would
    // silently mis-draw the moment a derived joint was added on the Python side.
    const withNewJoint = buildIndex(["a", "b", "c", "waist"]);
    expect(withNewJoint.a).toBe(0);
    expect(withNewJoint.waist).toBe(3);
  });
});

describe("frameAt", () => {
  const b = bundle([
    { f: 0, kp: [] },
    { f: 1, kp: [] },
    { f: 2, kp: [] },
  ]);

  it("returns the frame with the matching index", () => {
    expect(frameAt(b, 2)?.f).toBe(2);
  });

  it("returns null rather than a neighbour when a frame is missing", () => {
    // Drawing frame 3's skeleton on frame 2 is precisely the defect the frame-sync work exists to
    // prevent. A gap must render nothing rather than something plausible.
    expect(frameAt(b, 7)).toBeNull();
  });

  it("finds a frame even when the array is not densely indexed", () => {
    const sparse = bundle([
      { f: 10, kp: [] },
      { f: 11, kp: [] },
    ]);
    expect(frameAt(sparse, 11)?.f).toBe(11);
    expect(frameAt(sparse, 0)).toBeNull();
  });
});

describe("rendering constants", () => {
  it("gates confidence at the same value the analyzer used", () => {
    // Every consumer re-applies MIN_CONF. If this drifts from metrics.MIN_CONF the client starts
    // drawing points the analyzer treated as missing.
    expect(MIN_CONF).toBe(0.35);
  });

  it("names both ends of every bone, never an index", () => {
    for (const [from, to, side] of BONES) {
      expect(typeof from).toBe("string");
      expect(typeof to).toBe("string");
      expect(["L", "R", "M"]).toContain(side);
    }
  });

  it("connects the wrists to the grip, so the club is not drawn detached from the body", () => {
    const pairs = BONES.map(([a, b]) => `${a}->${b}`);
    expect(pairs).toContain("left_wrist->grip_center");
    expect(pairs).toContain("right_wrist->grip_center");
  });

  it("has no duplicate bones", () => {
    const pairs = BONES.map(([a, b]) => [a, b].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
