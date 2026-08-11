import {
  BONES,
  DRAWN_CONF,
  OMITTED_BONES,
  HIDE_JOINT,
  MIN_CONF,
  buildIndex,
  frameAt,
  sideOf,
  type PoseBundle,
} from "./pose";

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

describe("confidence gates", () => {
  it("keeps the measurement gate at the analyzer's value", () => {
    expect(MIN_CONF).toBe(0.35);
  });

  it("draws at a far looser gate than it measures", () => {
    // These are different questions and conflating them already caused a bug: gating RENDERING at
    // MIN_CONF deleted every joint between 0 and 0.35 that the web player draws, making the
    // mobile skeleton visibly sparser than the desktop one for no reason present in the data.
    expect(DRAWN_CONF).toBeLessThan(MIN_CONF);
    expect(DRAWN_CONF).toBe(0);
  });

  it("treats only confidence zero as missing for drawing", () => {
    // Zero is the analyzer's sentinel for a point it never located; 0.2 is a point it found and
    // was unsure about, which the player still draws.
    expect(0.2 > DRAWN_CONF).toBe(true);
    expect(0 > DRAWN_CONF).toBe(false);
  });
});

describe("joint dots", () => {
  it("hides face detail and finger tips, as the web player does", () => {
    for (const n of ["nose", "left_eye", "mouth_left", "right_pinky", "left_thumb", "jaw_1"]) {
      expect(HIDE_JOINT.test(n)).toBe(true);
    }
  });

  it("keeps every joint a coach actually reads", () => {
    for (const n of ["left_shoulder", "right_elbow", "mid_hip", "left_knee", "grip_center"]) {
      expect(HIDE_JOINT.test(n)).toBe(false);
    }
  });

  it("still hides face and finger dots", () => {
    expect(HIDE_JOINT.test("left_pinky")).toBe(true);
    expect(HIDE_JOINT.test("nose")).toBe(true);
  });

  it("colours by anatomical side", () => {
    expect(sideOf("left_knee")).toBe("L");
    expect(sideOf("right_knee")).toBe("R");
    expect(sideOf("neck")).toBe("M");
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

  it("omits the knuckle line, whose keypoints are too unreliable to draw", () => {
    // Dropped on the client's judgement: a hand is a few dozen pixels across down the line, so the
    // two knuckles sit inside each other's noise. Drawing a roll cue from that is a confident
    // wrong number. Asserted so the bone cannot creep back in with a future port from the web.
    for (const [a, b] of OMITTED_BONES) {
      expect(BONES.some(([x, y]) => x === a && y === b)).toBe(false);
    }
  });

  it("keeps the wrist angle, which is what the hand detail was standing in for", () => {
    // elbow -> wrist -> grip_center is the joint a coach actually reads.
    const pairs = BONES.map(([a, b]) => `${a}->${b}`);
    expect(pairs).toContain("left_elbow->left_wrist");
    expect(pairs).toContain("left_wrist->grip_center");
    expect(pairs).toContain("right_elbow->right_wrist");
    expect(pairs).toContain("right_wrist->grip_center");
  });

  it("has no duplicate bones", () => {
    const pairs = BONES.map(([a, b]) => [a, b].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
