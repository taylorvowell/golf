import { render, waitFor } from "@testing-library/react-native";

import { ApiClientError } from "../platform/api";

/**
 * Progress's invariants are honesty invariants:
 * - A request that never reached the server renders as "cannot reach", never as an empty page.
 * - Real aggregates (chips, net gain) come from the swing list; under two scored sessions the
 *   screen says "keep practising", it does not invent a trend.
 * - The mockup's "coach confidence" chip stays off screen — no measured aggregate backs it.
 */

const mockRequest = jest.fn();
const mockNavigate = jest.fn();

jest.mock("../platform/client", () => ({
  api: {
    request: (path: string) => mockRequest(path),
    mediaSource: async (path: string) => ({ uri: `http://test/${path}`, headers: {} }),
  },
}));
jest.mock("../navigation", () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

import { ProgressScreen } from "./ProgressScreen";
import { clearSwingsCache } from "../features/swings/useSwings";

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
    createdAt: Date.now() - 24 * 60 * 60 * 1000,
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
  clearSwingsCache();
});

describe("ProgressScreen", () => {
  it("shows real window aggregates and the net gain across two scored sessions", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    mockRequest.mockResolvedValue({
      swings: [
        swing({ id: "a", createdAt: Date.now() - 2 * dayMs, overallScore: 70 }),
        swing({ id: "b", createdAt: Date.now() - dayMs, overallScore: 78 }),
      ],
    });
    const { getByText } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByText("2 sessions")).toBeTruthy());
    expect(getByText("2 swings")).toBeTruthy();
    expect(getByText("Best score 78")).toBeTruthy();
    // Net gain 78 − 70, from real session averages.
    expect(getByText("+8")).toBeTruthy();
    expect(getByText("Session averages are climbing.")).toBeTruthy();
  });

  it("abstains from trends under two scored sessions", async () => {
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { getByText, getByTestId, queryByText } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByTestId("progress-low-data")).toBeTruthy());
    // The ring abstains rather than sweeping to an invented delta.
    expect(getByText("—")).toBeTruthy();
    expect(getByText("Keep practising to unlock trends.")).toBeTruthy();
    expect(queryByText(/^\+\d+$/)).toBeNull();
    // No comparison from one scored swing either.
    expect(getByTestId("progress-no-compare")).toBeTruthy();
  });

  it("compares the real then and now swings when two are scored", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    mockRequest.mockResolvedValue({
      swings: [
        swing({
          id: "old",
          label: "7-iron — 1 Aug",
          createdAt: Date.now() - 9 * dayMs,
          overallScore: 72,
        }),
        swing({
          id: "new",
          label: "Driver — 12 Aug",
          createdAt: Date.now() - dayMs,
          overallScore: 86,
        }),
      ],
    });
    const { getByText } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByText("7-iron — 1 Aug")).toBeTruthy());
    expect(getByText("Driver — 12 Aug")).toBeTruthy();
    expect(getByText("72")).toBeTruthy();
    expect(getByText("86")).toBeTruthy();
  });

  it("never renders a network failure as an empty progress page", async () => {
    mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    const { getByText, queryByTestId } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByText("Cannot reach SwingSage")).toBeTruthy());
    expect(queryByTestId("progress-empty")).toBeNull();
  });

  it("distinguishes a declined session from an unreachable server", async () => {
    mockRequest.mockRejectedValue(new ApiClientError(401, "unauthorized", "no session"));
    const { getByText, queryByText } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByText("Your session has expired")).toBeTruthy());
    expect(queryByText("Cannot reach SwingSage")).toBeNull();
  });

  it("shows the honest empty state only when the server said zero", async () => {
    mockRequest.mockResolvedValue({ swings: [] });
    const { getByTestId, queryByText } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByTestId("progress-empty")).toBeTruthy());
    // No canned coaching content on an empty log.
    expect(queryByText("AI coach priorities")).toBeNull();
  });

  it("never shows a canned confidence chip", async () => {
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { getByTestId, queryByText } = await render(<ProgressScreen />);
    await waitFor(() => expect(getByTestId("progress-chips")).toBeTruthy());
    expect(queryByText(/confidence/i)).toBeNull();
  });
});
