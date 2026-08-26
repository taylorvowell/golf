import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { ComparePanel } from "./ComparePanel";
import { phaseBands } from "./phaseBands";
import { clearSyncProfileCache } from "./useSyncProfile";
import { makeAnalysis } from "./overlay/__fixtures__/analysis";

/**
 * Comparison, and the line it does not cross.
 *
 * The picker's rules are simple and worth pinning: **a swing is never offered as a comparison with
 * itself**, and "reference swings" means swings that actually carry a `referenceLabel` rather than
 * a seeded catalogue of pros that does not exist.
 *
 * The comparison itself is the interesting part. It shows **timing and scores, never geometry**:
 * two swings filmed on two days from two distances have normalized coordinates that mean different
 * things, so drawing one golfer's trace over another's would be exactly the fabricated measurement
 * this project forbids. Durations are therefore in seconds, which survives the two clips having
 * different frame rates — the assertion below uses 120fps against 60 on purpose.
 *
 * The reference's numbers come from `/sync-profile`, not its `analysis.json`: this panel needs four
 * frame numbers, and reading them out of the artifact cost 22 MB on `pro_3`.
 */

const mockRequest = jest.fn();
const mockMediaSource = jest.fn();

jest.mock("../../platform/client", () => ({
  api: {
    request: (path: string) => mockRequest(path),
    mediaSource: (path: string) => mockMediaSource(path),
  },
}));

function summary(over: Partial<SwingSummary>): SwingSummary {
  return {
    id: "s1",
    label: "6iron3",
    referenceLabel: null,
    createdAt: 1_760_000_000_000,
    status: "ready",
    frameCount: 40,
    fps: 60,
    overallScore: 70,
    band: "solid",
    tempoRatio: 2.4,
    poseCoverage: 0.98,
    traceEnabled: true,
    model: "rtmw",
    primaryViewId: "v1",
    views: [],
    ...over,
  } as SwingSummary;
}

const THIS_SWING = "me";

/**
 * What `/sync-profile` answers for the reference — the same P1/P4/P7/P10 frames the fixture's
 * events carry, at DOUBLE the frame rate of the swing being watched.
 */
function refProfile(fps = 120) {
  return {
    swingId: "pro",
    view: "dtl",
    fps,
    frameCount: 40,
    width: 1080,
    height: 1920,
    handedness: "right",
    checkpoints: [
      { p: "P1", frame: 4, conf: 0.9 },
      { p: "P4", frame: 12, conf: 0.6 },
      { p: "P7", frame: 20, conf: 0.98 },
      { p: "P10", frame: 30, conf: 0.75 },
    ],
    audioDisagrees: false,
    subject: null,
  };
}

beforeEach(() => {
  clearSyncProfileCache();
  mockRequest.mockReset();
  mockMediaSource.mockReset();
  mockMediaSource.mockResolvedValue({ uri: "http://x/thumb", headers: {} });
  mockRequest.mockImplementation((path: string) => {
    if (path === "swings") {
      return Promise.resolve({
        swings: [
          summary({ id: THIS_SWING, label: "mine-current" }),
          summary({ id: "other", label: "mine-older" }),
          summary({ id: "pro", label: "pro_3", referenceLabel: "Tour player", overallScore: 91 }),
        ],
      });
    }
    return Promise.resolve(refProfile());
  });
});

function panel(over: Partial<React.ComponentProps<typeof ComparePanel>> = {}) {
  const bands = phaseBands(makeAnalysis(), undefined, { first: 4, last: 30 });
  return (
    <ComparePanel
      swingId={THIS_SWING}
      fps={60}
      frameCount={40}
      bands={bands}
      score={70}
      tempoRatio={2.4}
      reference={null}
      onReference={() => {}}
      onExit={() => {}}
      {...over}
    />
  );
}

it("never offers the swing you are watching as its own comparison", async () => {
  const { queryByTestId, getByTestId } = await render(panel());
  await waitFor(() => expect(getByTestId(`compare-pick-pro`)).toBeTruthy());
  expect(queryByTestId(`compare-pick-${THIS_SWING}`)).toBeNull();
});

it("splits reference swings from your own by the label they carry", async () => {
  // Not a seeded library of pros — a swing becomes a reference when it is given a reference label,
  // and the tab is honest about being whatever exists.
  const api = await render(panel());
  await waitFor(() => expect(api.getByTestId("compare-pick-pro")).toBeTruthy());
  // The reference tab is the default, so the golfer's own older swing is not in it.
  expect(api.queryByTestId("compare-pick-other")).toBeNull();

  await act(async () => void fireEvent.press(api.getByLabelText("My swings, 1")));
  await waitFor(() => expect(api.getByTestId("compare-pick-other")).toBeTruthy());
});

it("compares in seconds, so two different frame rates stay comparable", async () => {
  // The reference is 120fps against this swing's 60. Frame counts would be off by a factor of two
  // while both looked like plausible numbers — which is the whole reason this is not in frames.
  const reference = summary({ id: "pro", label: "pro_3", referenceLabel: "Tour player", fps: 120 });
  const { getByTestId, getAllByText } = await render(panel({ reference }));

  await waitFor(() => expect(getByTestId("compare-result")).toBeTruthy());
  // Backswing is frames 4–12 in the fixture: 0.13s at 60fps, 0.07s at 120.
  await waitFor(() => expect(getAllByText("0.13s").length).toBeGreaterThan(0));
  expect(getAllByText("0.07s").length).toBeGreaterThan(0);
});

it("never fetches the reference's whole artifact to time its phases", async () => {
  // Four frame numbers. Reading them from `analysis.json` cost 5.9 MB on `6iron-1` and 22 MB on
  // `pro_3`, and this panel used to pay it a second time beside the pane's own copy.
  const reference = summary({ id: "pro", referenceLabel: "Tour player" });
  const { getByTestId } = await render(panel({ reference }));
  await waitFor(() => expect(getByTestId("compare-result")).toBeTruthy());
  expect(mockRequest).toHaveBeenCalledWith("swings/pro/sync-profile");
  expect(mockRequest.mock.calls.every(([p]) => !String(p).includes("analysis"))).toBe(true);
});

it("leaves a phase blank rather than timing it off a position nobody measured", async () => {
  // `7wood-1`'s shape: the top is the ordering nudge, one frame from its neighbours at conf 0.35.
  // A backswing quoted from it would be a number with nothing behind it.
  mockRequest.mockImplementation((path: string) =>
    path === "swings"
      ? Promise.resolve({ swings: [summary({ id: "pro", referenceLabel: "Tour player" })] })
      : Promise.resolve({
          ...refProfile(60),
          checkpoints: [
            { p: "P1", frame: 4, conf: 0.9 },
            { p: "P4", frame: 19, conf: 0.35 },
            { p: "P7", frame: 20, conf: 0.98 },
            { p: "P10", frame: 30, conf: 0.75 },
          ],
        }),
  );
  const reference = summary({ id: "pro", referenceLabel: "Tour player" });
  const { getByTestId, getAllByText } = await render(panel({ reference }));
  await waitFor(() => expect(getByTestId("compare-result")).toBeTruthy());
  // Backswing and downswing both bounded by the rejected top; Through (P7→P10) survives.
  await waitFor(() => expect(getAllByText("—").length).toBeGreaterThanOrEqual(2));
  expect(getAllByText("0.17s").length).toBeGreaterThan(0);
});

it("says what it cannot compare rather than leaving the row blank", async () => {
  const reference = summary({ id: "pro", referenceLabel: "Tour player", overallScore: null });
  const { getByText } = await render(panel({ reference }));
  await waitFor(() => expect(getByText("not scored")).toBeTruthy());
});

it("hands the chosen swing back so the player can enter the comparison", async () => {
  // The picker's whole output. The player answers it by collapsing this sheet and putting the two
  // pictures side by side — leaving the sheet up meant choosing a swing and then having to dismiss
  // a panel to see the thing you had just asked for.
  const onReference = jest.fn();
  const { getByTestId, findByTestId } = await render(panel({ onReference }));
  await act(async () => void fireEvent.press(await findByTestId("compare-pick-pro")));
  expect(onReference).toHaveBeenCalledWith(expect.objectContaining({ id: "pro" }));
  expect(getByTestId("compare-panel")).toBeTruthy();
});

it("offers a way out of a comparison that is not the orb that opened it", async () => {
  const onExit = jest.fn();
  const reference = summary({ id: "pro", referenceLabel: "Tour player" });
  const { findByTestId } = await render(panel({ reference, onExit }));
  await act(async () => void fireEvent.press(await findByTestId("compare-stop")));
  expect(onExit).toHaveBeenCalled();
});
