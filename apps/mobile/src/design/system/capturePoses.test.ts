import { CAPTURE_POSES, posePlacement } from "./capturePoses";

/**
 * The left-handed mirror is a reflection, not a second layout: the mirrored figure must land
 * exactly where a mirror would put the right-handed one, or the lefty's alignment guide teaches
 * a stance the analyzer will then refuse to read.
 */
describe("posePlacement mirroring", () => {
  const stages: Array<[number, number]> = [
    [390, 844], // phone portrait
    [460, 1000], // the artboard itself
    [800, 600], // wider than the artboard — contain-fit pillarboxes
  ];

  it.each(Object.keys(CAPTURE_POSES) as Array<"dtl" | "face_on">)(
    "%s reflects about the stage centre and changes nothing else",
    (view) => {
      for (const [w, h] of stages) {
        const plain = posePlacement(view, w, h);
        const mirrored = posePlacement(view, w, h, true);
        // The artboard is centred in the stage, so the reflection is about the STAGE centre.
        expect(mirrored.left).toBeCloseTo(w - (plain.left + plain.width), 6);
        expect(mirrored.top).toBeCloseTo(plain.top, 6);
        expect(mirrored.width).toBeCloseTo(plain.width, 6);
        expect(mirrored.height).toBeCloseTo(plain.height, 6);
      }
    },
  );
});
