import { render, waitFor } from "@testing-library/react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { ReferencePane, type CompareStatus } from "./ReferencePane";
import { clearSyncProfileCache } from "./useSyncProfile";

/**
 * The comparison's honesty rule: **a pair that cannot be lined up must say so.**
 *
 * A silently misaligned pair looks exactly like a working one — two pictures side by side, both
 * moving — and a golfer reading them would take two different points in two swings as a difference
 * in their own. That is the failure the reported status exists to prevent, and it is why "no
 * alignment" is a state that reaches the screen rather than a silent fallback.
 *
 * The sentence is drawn by the parent, not here: it is a fact about BOTH pictures, and printing it
 * on the right-hand column reads as that swing being at fault when the leader's own impact may be
 * the contested one. So these tests assert on what the pane REPORTS.
 *
 * The mapping arithmetic itself is `align.test.ts`, against the real fixture anchor tables.
 */

const mockMediaSource = jest.fn();
const mockRequest = jest.fn();

jest.mock("../../platform/client", () => ({
  api: {
    mediaSource: (path: string) => mockMediaSource(path),
    request: (path: string) => mockRequest(path),
  },
}));

const REFERENCE = {
  id: "ref-1",
  label: "6iron3",
  referenceLabel: "Pro Swing",
  fps: 60,
  frameCount: 900,
  createdAt: 1_700_000_000,
  overallScore: 88,
  tempoRatio: 3.1,
} as unknown as SwingSummary;

/** Anchors matching `swing1`'s real table, so the aligned case is a real one. */
const LEADER = {
  checkpoints: [
    { p: "P1", frame: 150, conf: 0.6 },
    { p: "P4", frame: 198, conf: 0.35 },
    { p: "P7", frame: 221, conf: 0.98 },
  ],
};

/** What `/sync-profile` answers with — the projection, not the artifact. */
function profile(over: Record<string, unknown> = {}) {
  return {
    swingId: "ref-1",
    view: "dtl",
    fps: 60,
    frameCount: 900,
    width: 1080,
    height: 1920,
    handedness: "right",
    checkpoints: [],
    audioDisagrees: false,
    subject: null,
    ...over,
  };
}

function statuses() {
  const seen: CompareStatus[] = [];
  return { seen, onAlignment: (s: CompareStatus) => seen.push(s) };
}

beforeEach(() => {
  // The profile cache is module-level and every test here reuses the same swing id with a
  // different answer — without the reset, one test's profile answers the next test's mount.
  clearSyncProfileCache();
  mockMediaSource.mockReset();
  mockRequest.mockReset();
  mockMediaSource.mockResolvedValue({
    uri: "http://api.test.invalid/api/v1/swings/ref-1/video",
    headers: { Authorization: "Bearer test-token" },
  });
});

it("reads the cheap profile, never the whole artifact", async () => {
  // 5.9 MB on `6iron-1` and 22 MB on `pro_3`, for ten integers — and nothing is drawn on this
  // pane, so every one of those megabytes was downloaded and thrown away.
  mockRequest.mockResolvedValue(profile());

  const { onAlignment } = statuses();
  await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} onAlignment={onAlignment} />,
  );

  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith("swings/ref-1/sync-profile"));
  expect(mockRequest.mock.calls.every(([p]) => !String(p).includes("analysis"))).toBe(true);
});

it("says an unanalysed reference cannot be lined up, and still shows it", async () => {
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));

  const { seen, onAlignment } = statuses();
  const { getByTestId } = await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} onAlignment={onAlignment} />,
  );

  await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "unaligned" }));
  expect((seen.at(-1) as { note: string }).note).toMatch(/cannot be lined up/i);
  // The video is still a real swing — it loses the claim that the two pictures correspond, not
  // its right to be on screen.
  expect(getByTestId("reference-pane")).toBeTruthy();
});

it("says so when a swing has too few detected positions to line up at all", async () => {
  // One anchor defines no segment to interpolate within, so there is no honest mapping.
  mockRequest.mockResolvedValue(profile({ checkpoints: [{ p: "P4", frame: 500, conf: 0.9 }] }));

  const { seen, onAlignment } = statuses();
  await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} onAlignment={onAlignment} />,
  );

  await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "unaligned" }));
  expect((seen.at(-1) as { note: string }).note).toMatch(/too few detected positions/i);
});

it("refuses a reference whose impact was never really found", async () => {
  // `7wood-1`'s table verbatim: ten rows, strictly increasing, and P4–P10 stacked into eight
  // consecutive frames by the ordering nudge. Nothing survives at or after impact.
  mockRequest.mockResolvedValue(profile({
    checkpoints: [
      { p: "P1", frame: 236, conf: 0.9 },
      { p: "P2", frame: 266, conf: 0.8 },
      { p: "P3", frame: 342, conf: 0.95 },
      { p: "P4", frame: 343, conf: 0.35 },
      { p: "P5", frame: 344, conf: 0.35 },
      { p: "P6", frame: 345, conf: 0.3 },
      { p: "P7", frame: 346, conf: 0.35 },
      { p: "P8", frame: 347, conf: 0.35 },
      { p: "P9", frame: 348, conf: 0.3 },
      { p: "P10", frame: 349, conf: 0.35 },
    ],
  }));

  // A leader sharing the three positions 7wood-1 keeps, so the pair fails on the RIGHT ground:
  // three anchors in common and not one of them at or after impact.
  const leader = {
    checkpoints: [
      { p: "P1", frame: 150, conf: 0.9 },
      { p: "P2", frame: 167, conf: 0.8 },
      { p: "P3", frame: 183, conf: 0.94 },
      { p: "P7", frame: 221, conf: 0.98 },
    ],
  };

  const { seen, onAlignment } = statuses();
  await render(
    <ReferencePane reference={REFERENCE} leader={leader} frame={198} width={180} height={320} onAlignment={onAlignment} />,
  );

  await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "unaligned" }));
  expect((seen.at(-1) as { note: string }).note).toMatch(/impact/i);
});

it("reports a clean alignment when the two swings can be lined up", async () => {
  mockRequest.mockResolvedValue(profile({
    checkpoints: [
      { p: "P1", frame: 300, conf: 0.9 },
      { p: "P4", frame: 700, conf: 0.6 },
      { p: "P7", frame: 900, conf: 0.98 },
    ],
  }));

  const { seen, onAlignment } = statuses();
  const { getByTestId } = await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} onAlignment={onAlignment} />,
  );

  await waitFor(() => expect(getByTestId("reference-video")).toBeTruthy());
  // Three shared positions and no takeaway anchor: it maps, and it says the between-anchor
  // stretches are coarse rather than claiming a precision it does not have.
  await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "approximate", anchors: 3 }));
});

it("uses the reference's OWN frame rate and shape, not the swing being watched", async () => {
  // A reference filmed on another phone used to be laid out from the leader's artifact — squeezed
  // into a box shaped for someone else's video, and seeked against someone else's frame rate.
  mockRequest.mockResolvedValue(profile({ fps: 120, width: 720, height: 1280 }));

  const { getByTestId } = await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} />,
  );

  // 60 here would be the summary row's number, or the leader's — either way the follower would be
  // seeked to the wrong instant on every frame of a high-speed reference.
  await waitFor(() => expect(getByTestId("reference-video").props.fps).toBe(120));
});

it("carries the session on the reference video, like every other media surface", async () => {
  // `/video` unauthenticated is answered as the dev identity and returns 404, not 401 — so a
  // missing header renders as a swing that does not exist (D48, D50).
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));

  const { getByTestId } = await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} />,
  );

  await waitFor(() => expect(mockMediaSource).toHaveBeenCalledWith("swings/ref-1/video"));
  await waitFor(() => {
    const video = getByTestId("reference-video");
    expect(video.props.headers).toEqual({ Authorization: "Bearer test-token" });
  });
});

it("names the swing it is showing", async () => {
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));
  const { findByText } = await render(
    <ReferencePane reference={REFERENCE} leader={LEADER} frame={198} width={180} height={320} />,
  );
  expect(await findByText("Pro Swing")).toBeTruthy();
});
