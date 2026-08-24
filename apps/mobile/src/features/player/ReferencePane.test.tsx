import { render, waitFor } from "@testing-library/react-native";
import type { Analysis, SwingSummary } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { clearAnalysisCache } from "./useAnalysis";
import { ReferencePane } from "./ReferencePane";

/**
 * The comparison's honesty rule: **a pair that cannot be lined up must say so.**
 *
 * A silently misaligned pair looks exactly like a working one — two pictures side by side, both
 * moving — and a golfer reading them would take two different points in two swings as a difference
 * in their own. That is the failure this pane's notice exists to prevent, and it is why "no
 * alignment" is a rendered state rather than a silent fallback.
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
    { p: "P1", label: "Address", frame: 150 },
    { p: "P4", label: "Top", frame: 198 },
    { p: "P7", label: "Impact", frame: 221 },
  ],
} as unknown as Analysis;

beforeEach(() => {
  // The artifact cache is module-level and every test here reuses the same swing id with a
  // different fixture — without the reset, one test's artifact answers the next test's mount.
  clearAnalysisCache();
  mockMediaSource.mockReset();
  mockRequest.mockReset();
  mockMediaSource.mockResolvedValue({
    uri: "http://api.test.invalid/api/v1/swings/ref-1/video",
    headers: { Authorization: "Bearer test-token" },
  });
});

it("says an unanalysed reference cannot be lined up, and still shows it", async () => {
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));

  const { getByTestId, findByText } = await render(
    <ReferencePane reference={REFERENCE} leaderAnalysis={LEADER} frame={198} width={180} height={320} />,
  );

  expect(await findByText(/cannot be lined up/i)).toBeTruthy();
  // The video is still a real swing — it loses the claim that the two pictures correspond, not
  // its right to be on screen.
  expect(getByTestId("reference-pane")).toBeTruthy();
});

it("says so when the two swings share too few detected positions", async () => {
  // Analysed, but with only one position in common — one anchor defines no segment to interpolate
  // within, so there is no honest mapping.
  mockRequest.mockResolvedValue({
    checkpoints: [{ p: "P4", label: "Top", frame: 500 }],
  });

  const { findByText } = await render(
    <ReferencePane reference={REFERENCE} leaderAnalysis={LEADER} frame={198} width={180} height={320} />,
  );

  expect(await findByText(/too few detected positions/i)).toBeTruthy();
});

it("shows no notice when the two swings can be aligned", async () => {
  mockRequest.mockResolvedValue({
    checkpoints: [
      { p: "P1", label: "Address", frame: 300 },
      { p: "P4", label: "Top", frame: 700 },
      { p: "P7", label: "Impact", frame: 900 },
    ],
  });

  const { queryByText, getByTestId } = await render(
    <ReferencePane reference={REFERENCE} leaderAnalysis={LEADER} frame={198} width={180} height={320} />,
  );

  await waitFor(() => expect(getByTestId("reference-video")).toBeTruthy());
  await waitFor(() => expect(queryByText(/cannot be lined up/i)).toBeNull());
  expect(queryByText(/too few detected positions/i)).toBeNull();
});

it("carries the session on the reference video, like every other media surface", async () => {
  // `/video` unauthenticated is answered as the dev identity and returns 404, not 401 — so a
  // missing header renders as a swing that does not exist (D48, D50).
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));

  const { getByTestId } = await render(
    <ReferencePane reference={REFERENCE} leaderAnalysis={LEADER} frame={198} width={180} height={320} />,
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
    <ReferencePane reference={REFERENCE} leaderAnalysis={LEADER} frame={198} width={180} height={320} />,
  );
  expect(await findByText("Pro Swing")).toBeTruthy();
});
