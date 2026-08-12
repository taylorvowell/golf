import { fireEvent, render, waitFor } from "@testing-library/react-native";

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
jest.mock("../features/auth/AccountBar", () => ({ AccountBar: () => null }));

import { SwingLogScreen } from "./SwingLogScreen";

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
});

describe("SwingLogScreen", () => {
  it("lists the golfer's swings", async () => {
    mockRequest.mockResolvedValue({ swings: [swing()] });
    const { getByText } = await render(<SwingLogScreen />);
    await waitFor(() => expect(getByText("Driver — 12 Aug")).toBeTruthy());
    expect(getByText("72")).toBeTruthy();
  });

  it("never renders a network failure as an empty swing log", async () => {
    mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    const { getByText, getByTestId, queryByText } = await render(<SwingLogScreen />);

    await waitFor(() => expect(getByText("Cannot reach SwingSage")).toBeTruthy());
    expect(queryByText("No swings yet")).toBeNull();
    expect(getByTestId("swing-log-retry")).toBeTruthy();
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
