import { makeAnalysis } from "./__fixtures__/analysis";
import { MIN_CONF, keypointIndex, resolveAngle } from "./geometry";
import { buildTrace, orientationHold, traceSpans } from "./model";
import { availableGroups, drawableAngles, hasCapability } from "./overlays";
import { DEFAULT_SMOOTHING } from "./traceSmoothing";

/**
 * What the overlay must refuse to draw.
 *
 * Every assertion here is about **abstaining**, because that is the half of this feature that is
 * invisible when it breaks: a skeleton in the wrong place is obvious, whereas an angle drawn from a
 * keypoint the analyzer treated as missing looks exactly like a real measurement. The project's own
 * history is the argument — nine rotation checks once shipped reading a quantity that decreases as
 * a golfer turns, and one of them scored 100.
 */

describe("traceSpans", () => {
  it("splits at the analyzer's own event frames", () => {
    expect(traceSpans(makeAnalysis())).toEqual({
      backswing: [2, 12],
      downswing: [12, 18],
      followthrough: [18, 26],
    });
  });

  it("abstains when the swing has no events", () => {
    expect(traceSpans(makeAnalysis({ events: false }))).toBeNull();
  });
});

describe("buildTrace", () => {
  it("bridges a gap instead of drawing through it", () => {
    // The trace never interpolates: a run of frames the detector did not answer is a straight
    // chord, because on held-out gaps no reconstruction beat a straight line.
    const a = makeAnalysis({ traceGap: true });
    const pieces = buildTrace(a, traceSpans(a), DEFAULT_SMOOTHING);
    expect(pieces.backswing.some((p) => p.bridge)).toBe(true);
  });

  it("does not bridge a continuous run", () => {
    const a = makeAnalysis({ traceGap: false });
    const pieces = buildTrace(a, traceSpans(a), DEFAULT_SMOOTHING);
    expect(pieces.backswing.some((p) => p.bridge)).toBe(false);
  });

  it("returns empty segments rather than throwing when the swing has no club", () => {
    const a = makeAnalysis({ club: false });
    expect(buildTrace(a, traceSpans(a), DEFAULT_SMOOTHING)).toEqual({
      backswing: [],
      downswing: [],
      followthrough: [],
    });
  });

  it("builds in video-pixel space, so the path survives a resize", () => {
    const a = makeAnalysis();
    const pieces = buildTrace(a, traceSpans(a), DEFAULT_SMOOTHING);
    const xs = pieces.backswing.flatMap((p) => p.pts.map(([x]) => x));
    // Normalized coordinates would all be below 1. These are pixels of a 1080-wide frame.
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });
});

describe("orientationHold", () => {
  it("holds the last trusted angle rather than following a foreshortened pair", () => {
    const a = makeAnalysis();
    const tracks = orientationHold(a, keypointIndex(a));
    expect(tracks).toHaveLength(2);
    // The fixture's pairs sit close together, well under the live threshold, so nothing is ever
    // trusted — and the layer is told so rather than being handed a direction it should not draw.
    expect(tracks[0].held[0]).toBe(1);
    expect(Number.isNaN(tracks[0].dir[0])).toBe(true);
  });

  it("is a pure function of the artifact — the same frame gives the same bar", () => {
    // A running filter fed by the playhead would not, and the difference only shows up when
    // somebody scrubs backwards.
    const a = makeAnalysis();
    const one = orientationHold(a, keypointIndex(a));
    const two = orientationHold(a, keypointIndex(a));
    expect(Array.from(one[0].dir)).toEqual(Array.from(two[0].dir));
  });
});

describe("resolveAngle", () => {
  it("resolves a drawable field into an origin and two rays", () => {
    const a = makeAnalysis();
    const spec = a.metrics!.angle_fields!.find((f) => f.field === "lead_knee_flex")!;
    const r = resolveAngle(spec, a, keypointIndex(a), 5);
    expect(r).not.toBeNull();
    // The label is READ from `metrics.series`, never derived from the rays — which is why the arc
    // and the number cannot disagree.
    expect(r!.value).toBe(24.5);
    // `supplement` marks a `_flex` field, whose first ray opens from the bone's continuation
    // through the joint, so it draws dashed.
    expect(r!.uDashed).toBe(true);
    expect(r!.vDashed).toBe(false);
  });

  it("abstains when a keypoint is below MIN_CONF", () => {
    const a = makeAnalysis({ conf: MIN_CONF - 0.01 });
    const spec = a.metrics!.angle_fields!.find((f) => f.field === "lead_knee_flex")!;
    expect(resolveAngle(spec, a, keypointIndex(a), 5)).toBeNull();
  });

  it("abstains when the field has no geometry", () => {
    const a = makeAnalysis();
    const spec = a.metrics!.angle_fields!.find((f) => f.field === "shoulder_turn_est")!;
    expect(resolveAngle(spec, a, keypointIndex(a), 5)).toBeNull();
  });

  it("abstains when the artifact has no value for this frame", () => {
    const a = makeAnalysis();
    const spec = a.metrics!.angle_fields!.find((f) => f.field === "lead_knee_flex")!;
    expect(resolveAngle(spec, a, keypointIndex(a), 9999)).toBeNull();
  });
});

describe("capabilities", () => {
  it("hides the club group on a swing analysed without a club", () => {
    // Hidden, never disabled: a native client cannot be force-updated, so an artifact older than
    // the build is permanent reality here.
    const titles = availableGroups(makeAnalysis({ club: false })).map((g) => g.title);
    expect(titles).toEqual(["Body"]);
    expect(hasCapability(makeAnalysis({ club: false }), "club")).toBe(false);
  });

  it("keeps the club group on a swing that has one", () => {
    expect(availableGroups(makeAnalysis()).map((g) => g.title)).toEqual(["Body", "Club"]);
  });

  it("offers no angle whose geometry is null", () => {
    const fields = drawableAngles(makeAnalysis()).map((f) => f.field);
    expect(fields).toContain("lead_knee_flex");
    expect(fields).not.toContain("shoulder_turn_est");
  });

  it("offers nothing at all without an artifact", () => {
    expect(drawableAngles(null)).toEqual([]);
    expect(availableGroups(null).map((g) => g.title)).toEqual(["Body"]);
  });
});
