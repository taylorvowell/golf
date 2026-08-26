import { act, renderHook, waitFor } from "@testing-library/react-native";

/**
 * The import review's two clocks and its detector, pinned (video-analysis-redesign step 01).
 *
 * Two bugs the 2026-08-26 audit found live in this flow, each invisible on an ordinary clip
 * and wrong on every slow-mo import:
 *
 *  - `detectImpacts(path, 3, undefined, true)` — Kotlin's `Method.parse(null)` silently fell
 *    back to ATTACK, the detector `swish` replaced, while the comment beside the call claimed
 *    parity with the recorded path.
 *  - `fps = captureFps` — a 240 frame clock stamped on a container that advances at 30, which
 *    corrupted every `seekToFrame(round(sec × fps))` in the review and everything downstream
 *    reading `SavedImport.fps`.
 */

const mockPick = jest.fn();
const mockImport = jest.fn();

jest.mock("./importSwing", () => ({
  pickSwingVideo: (...args: unknown[]) => mockPick(...args),
  importSwing: (...args: unknown[]) => mockImport(...args),
}));
jest.mock("../session/processing", () => ({
  getProcessing: () => null,
  subscribeProcessing: () => () => undefined,
}));
jest.mock("../profile/useProfile", () => ({ useHandedness: () => "right" }));
jest.mock("../toast/ToastProvider", () => ({ useToast: () => jest.fn() }));

import HighSpeedCamera from "../../../modules/high-speed-camera/src";
import { useImportSwing } from "./useImportSwing";

const probeClip = HighSpeedCamera.probeClip as jest.Mock;
const detectImpacts = HighSpeedCamera.detectImpacts as jest.Mock;

/** Walk the hook from pick to the confirm screen and hand back its state. */
async function reviewOf(probe: { captureFps: number; videoFps: number; durationMs: number }) {
  probeClip.mockResolvedValue(probe);
  detectImpacts.mockResolvedValue([{ timeSec: 20, score: 1 }]);
  mockPick.mockResolvedValue({
    kind: "picked",
    clip: {
      uri: "file:///library/slow.mp4",
      fileName: "slow.mp4",
      durationMs: probe.durationMs,
      sizeBytes: 1,
    },
  });

  const { result } = await renderHook(() => useImportSwing([]));
  // The async-act form is the house pattern (TabBar.test.tsx) — a sync act around a callback
  // that starts async work leaks an open act into the next test's render.
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.pending).not.toBeNull());
  await act(async () => result.current.confirm("dtl"));
  await waitFor(() => expect(result.current.review?.phase).toBe("confirm"));
  const review = result.current.review;
  if (review?.phase !== "confirm") throw new Error("review never reached confirm");
  return review;
}

beforeEach(() => {
  mockPick.mockReset();
  mockImport.mockReset();
  probeClip.mockReset();
  detectImpacts.mockReset();
});

it("runs the recorded path's detector — swish, edge-weighted — never the Kotlin fallback", async () => {
  await reviewOf({ captureFps: 0, videoFps: 30, durationMs: 8_000 });
  // The resolved seeding, stated: `undefined` here is how ATTACK snuck back in.
  expect(detectImpacts).toHaveBeenCalledWith("/library/slow.mp4", 3, "swish", true);
});

it("a slow-mo import's take keeps the container clock, slow-mo factor alongside", async () => {
  const review = await reviewOf({ captureFps: 240, videoFps: 30, durationMs: 41_600 });
  // Frame math seeks against the CONTAINER's 30 — the 240 lives only in the factor, which is
  // what the review window (real seconds, reviewWindow.test.ts) and playback rate consume.
  expect(review.take.fps).toBe(30);
  expect(review.take.slowMoFactor).toBe(8);
  expect(review.take.durationMs).toBe(41_600);
  // Detection's answer seeds the confirm loop unchanged, in file seconds.
  expect(review.impactSec).toBe(20);
});

it("an ordinary import stays an ordinary clip — no factor invented", async () => {
  const review = await reviewOf({ captureFps: 0, videoFps: 30, durationMs: 8_000 });
  expect(review.take.fps).toBe(30);
  expect(review.take.slowMoFactor).toBeUndefined();
});
