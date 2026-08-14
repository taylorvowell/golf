import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";

import { ApiClientError } from "../platform/api";

/**
 * The invariant under test is not the layout, it is the refusal to guess.
 *
 * A request that never reached the server must never render as "No swings yet". That reads as data
 * loss to the one person who would know the difference, and it is the mobile instance of the
 * project's standing rule that an uncertain answer is never presented as fact. The rule outlived
 * the placeholder screen it was first written for, which is the point of restating it here rather
 * than deleting it with `HomeScreen`.
 *
 * The second invariant is scoring honesty: `overallScore` is nullable and a card that draws `null`
 * as `0` has told a golfer they scored zero.
 */

const mockRequest = jest.fn();
const mockNavigate = jest.fn();

jest.mock("../platform/client", () => ({
  api: {
    request: (path: string) => mockRequest(path),
    mediaSource: async (path: string) => ({ uri: `http://test/${path}`, headers: {} }),
  },
}));
jest.mock("../navigation", () => ({ useAppNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) }));
jest.mock("../design/TopBar", () => ({ TopBar: () => null }));

import { SwingLogScreen } from "./SwingLogScreen";
import { clearSwingsCache, useSwings } from "../features/swings/useSwings";

function swing(over: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    label: "Driver — 12 Aug",
    referenceLabel: null,
    views: [{ id: "v-1", view: "dtl" }],
    primaryViewId: "v-1",
    frameCount: 120,
    fps: 60,
    view: "dtl",
    overallScore: 72.4,
    band: "good",
    scoringModelVersion: "v2",
    status: "ready",
    createdAt: 1786500000,
    model: null,
    tempoRatio: 3.1,
    traceEnabled: true,
    poseCoverage: 0.97,
    ...over,
  };
}

beforeEach(() => {
  mockRequest.mockReset();
  mockNavigate.mockReset();
  // The list cache is module-level by design (it is what lets the detail screen open without a
  // serial refetch); tests reset it so each one exercises a cold start unless it says otherwise.
  clearSwingsCache();
});

describe("SwingLogScreen", () => {
  it("lists the golfer's swings", async () => {
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { getByText } = await render(<SwingLogScreen />);
    await waitFor(() => expect(getByText("Driver — 12 Aug")).toBeTruthy());
    expect(getByText("72")).toBeTruthy();
  });

  it("opens the after-swing preview on the newest swing", async () => {
    // The temporary door into the after-swing screen — it leaves when the capture flow starts
    // navigating there itself. Pinned so it cannot silently open the ordinary player instead.
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { getByTestId } = await render(<SwingLogScreen />);
    await waitFor(() => expect(getByTestId("open-after-swing")).toBeTruthy());

    fireEvent.press(getByTestId("open-after-swing"));
    expect(mockNavigate).toHaveBeenCalledWith("SwingDetail", { id: "s-1", afterSwing: true });
  });

  it("never renders a network failure as an empty swing log", async () => {
    mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    const { getByText, getByTestId, queryByText } = await render(<SwingLogScreen />);

    await waitFor(() => expect(getByText("Cannot reach SwingSage")).toBeTruthy());
    expect(queryByText("No swings yet")).toBeNull();
    expect(getByTestId("swing-log-retry")).toBeTruthy();
  });

  it("keeps a confirmed list when a re-fetch fails", async () => {
    // The failure invariant above is about a log that has NOTHING — a log holding real,
    // recently-confirmed swings keeps drawing them through a failed re-fetch, because stale truth
    // beats a network-error screen about data the device demonstrably has. Pinned at the hook:
    // the same `lastGood` retention is what lets the detail screen open a swing without a serial
    // refetch. (jest-expo's RCTRefreshControl mock strips testID, so the pull gesture itself is
    // not reachable here — the hook's refresh() is the same code path.)
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { result } = await renderHook(() => useSwings());
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));

    mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    await act(async () => {
      result.current.refresh();
    });
    expect(result.current.state).toEqual({ kind: "ok", swings: [swing()] });
    expect(result.current.refreshing).toBe(false);
  });

  it("distinguishes a declined session from an unreachable server", async () => {
    mockRequest.mockRejectedValue(new ApiClientError(401, "unauthorized", "no session"));
    const { getByText, queryByText } = await render(<SwingLogScreen />);

    await waitFor(() => expect(getByText("Your session has expired")).toBeTruthy());
    expect(queryByText("Cannot reach SwingSage")).toBeNull();
  });

  it("shows the empty state only when the server actually said zero", async () => {
    mockRequest.mockResolvedValue({ swings: [] });
    const { getByText } = await render(<SwingLogScreen />);
    await waitFor(() => expect(getByText("No swings yet")).toBeTruthy());
  });

  it("does not render an unscored swing as zero", async () => {
    mockRequest.mockResolvedValue({ swings: [swing({ overallScore: null, band: null })] });
    const { getByText, queryByText } = await render(<SwingLogScreen />);
    await waitFor(() => expect(getByText(/not\s*scored/)).toBeTruthy());
    expect(queryByText("0")).toBeNull();
  });

  it("routes to the swing when a card is tapped", async () => {
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { getByTestId } = await render(<SwingLogScreen />);
    await waitFor(() => expect(getByTestId("swing-card-s-1")).toBeTruthy());
    fireEvent.press(getByTestId("swing-card-s-1"));
    expect(mockNavigate).toHaveBeenCalledWith("SwingDetail", { id: "s-1" });
  });
});
