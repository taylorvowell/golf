import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

/**
 * Home's contract, pinned:
 *
 * 1. The log's trust invariant holds here too — a request that never reached the server renders
 *    as "cannot reach", never as an empty home implying the swings are gone.
 * 2. The hero is **aggregated, not copied** — the priority that recurred across the session's
 *    reports leads the screen even when a one-off outranks it inside a single report — and its
 *    door opens the exemplar swing's report.
 * 3. Honest abstention — no scores means no numbers and no hero, never a zero.
 * 4. The session slider's cards actually open their swings.
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
jest.mock("../features/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-in",
    session: null,
    userId: "u-1",
    email: "golfer@example.com",
    avatarUrl: null,
    firstName: "Taylor",
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
  }),
  onAccessTokenRefreshed: () => () => undefined,
}));

import { HomeScreen } from "./HomeScreen";
import { EntitlementProvider } from "../features/billing/entitlement";
import { clearReportsCache } from "../features/home/useSessionReports";
import { clearSwingsCache } from "../features/swings/useSwings";

/** Home mounts the SpotlightRail, whose entitlement gate needs the provider around it. */
function renderHome() {
  return render(
    <EntitlementProvider>
      <HomeScreen />
    </EntitlementProvider>,
  );
}

/** Yesterday, so the fixture session reads as completed rather than live. */
const BASE = Date.now() - 24 * 60 * 60 * 1000;

function swing(id: string, minutes: number, over: Record<string, unknown> = {}) {
  return {
    id,
    label: `Swing ${id}`,
    referenceLabel: null,
    views: [],
    primaryViewId: null,
    frameCount: 120,
    fps: 60,
    view: "dtl",
    overallScore: 70,
    band: "solid",
    scoringModelVersion: "v2",
    status: "ready",
    createdAt: BASE + minutes * 60_000,
    model: null,
    tempoRatio: 3.0,
    traceEnabled: true,
    poseCoverage: 0.97,
    ...over,
  };
}

function report(
  priorities: Array<{ key: string; label: string; cue: string; leverage: number; checkpoint?: string }>,
) {
  return {
    scoring_model_version: "v2",
    club_type: null,
    view: "dtl",
    overall: 70,
    band: "solid",
    arc_shift: null,
    coverage: { scored: 10, skipped_this_swing: 0, deferred_in_config: 0, total_checks: 10 },
    categories: {},
    checkpoints: {},
    findings: [],
    priorities: priorities.map((p) => ({ checkpoint: null, score: 60, ...p })),
    primary: { id: null, checkpoint: null, title: "", copy: "", moment: "", score: 0, leverage: 0 },
    drill: { title: "Pump drill", copy: "", dose: "3 × 10 slow reps", doseNote: "" },
  };
}

beforeEach(() => {
  mockRequest.mockReset();
  mockNavigate.mockReset();
  clearSwingsCache();
  clearReportsCache();
});

describe("HomeScreen", () => {
  it("leads with the recurring priority and its door opens the exemplar swing's report", async () => {
    const swings = [
      // A bundled reference swing, a day older — the "pro" half of the compare strip. Its
      // session is not the latest, so no report is ever fetched for it.
      swing("pro-1", -24 * 60, { referenceLabel: "Pro Swing", overallScore: 80 }),
      swing("s-1", 0, { overallScore: 62 }),
      swing("s-2", 5, { overallScore: 74 }),
      swing("s-3", 10, { overallScore: 68 }),
    ];
    const reports: Record<string, unknown> = {
      "s-1": report([
        { key: "tempo", label: "Tempo", cue: "slow the takeaway", leverage: 95 },
        { key: "hip_turn", label: "Hip turn", cue: "old cue", leverage: 40, checkpoint: "P1" },
      ]),
      "s-2": report([
        { key: "hip_turn", label: "Hip turn", cue: "clear the lead hip", leverage: 45, checkpoint: "P4" },
      ]),
      "s-3": report([
        { key: "hip_turn", label: "Hip turn", cue: "clear the lead hip", leverage: 45, checkpoint: "P4" },
      ]),
    };
    mockRequest.mockImplementation((path: string) => {
      if (path === "swings") return Promise.resolve({ swings });
      const m = /^swings\/(.+)\/report/.exec(path);
      if (m && reports[m[1]]) return Promise.resolve(reports[m[1]]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const { findAllByText, findByText, findByTestId } = await renderHome();

    // The recurring fault leads with the greeting and the newest cue; the one-off big leverage
    // number rides the rail, not the hero. The cue appears twice by design — hero and strip.
    expect(await findByTestId("home-focus")).toBeTruthy();
    // The greeting is the hero's; the card names the moment.
    expect(await findByText("Hey Taylor")).toBeTruthy();
    expect(await findByText(/next time out/i)).toBeTruthy();
    expect(await findByText("Hip turn")).toBeTruthy();
    expect((await findAllByText("clear the lead hip")).length).toBeGreaterThanOrEqual(1);
    expect(await findByText("Seen in 3 of 3 scored swings")).toBeTruthy();
    expect(await findByTestId("home-tip-tempo")).toBeTruthy();
    expect(await findByText(/Pump drill/)).toBeTruthy();

    // The hero's promise: the report, on the newest swing that ranked the priority. (ONE
    // player by decision, 2026-08-17 — checkpoint parking returns when the report player
    // learns it.)
    await act(async () => void fireEvent.press(await findByTestId("home-see-it")));
    expect(mockNavigate).toHaveBeenCalledWith("SwingDetail", { id: "s-3" });

    // You-vs-pro renders because a reference swing exists and the tip has a checkpoint, and it
    // opens the same door.
    mockNavigate.mockClear();
    await act(async () => void fireEvent.press(await findByTestId("home-compare")));
    expect(mockNavigate).toHaveBeenCalledWith("SwingDetail", { id: "s-3" });

    // The session slider carries the measured numbers ("74" twice by design — the hero's
    // best tile and the slide it came from).
    expect((await findAllByText("74")).length).toBeGreaterThanOrEqual(1);
    expect(await findByText("62")).toBeTruthy();
  });

  it("never renders a network failure as an empty home", async () => {
    mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    const { findByText, queryByText } = await renderHome();

    expect(await findByText("Cannot reach SwingSage")).toBeTruthy();
    expect(queryByText("No swings yet")).toBeNull();
  });

  it("shows the empty state only when the server actually said zero", async () => {
    mockRequest.mockResolvedValue({ swings: [] });
    const { findByTestId } = await renderHome();
    expect(await findByTestId("home-empty")).toBeTruthy();
  });

  it("abstains on an unscored session: no zeros, no hero", async () => {
    mockRequest.mockImplementation((path: string) =>
      path === "swings"
        ? Promise.resolve({ swings: [swing("s-1", 0, { overallScore: null, band: null })] })
        : Promise.reject(new Error(`unexpected ${path}`)),
    );
    const { findByTestId, findByText, queryByTestId, queryByText } = await renderHome();

    expect(await findByTestId("home-session")).toBeTruthy();
    expect(await findByTestId("home-swing-s-1")).toBeTruthy();
    expect(await findByText(/not\s*scored/)).toBeTruthy();
    expect(queryByTestId("home-focus")).toBeNull();
    expect(queryByText("0")).toBeNull();
  });

  it("opens a swing from the session slider", async () => {
    const swings = [
      swing("s-1", 0, { overallScore: 62 }),
      swing("s-2", 5, { overallScore: 74 }),
    ];
    mockRequest.mockImplementation((path: string) =>
      path === "swings" ? Promise.resolve({ swings }) : Promise.resolve(report([])),
    );
    const { findByTestId, queryByTestId } = await renderHome();

    await act(async () => void fireEvent.press(await findByTestId("home-swing-s-2")));
    expect(mockNavigate).toHaveBeenCalledWith("SwingDetail", { id: "s-2" });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    // No reference swing in the log → no half-comparison pretending to be one.
    expect(queryByTestId("home-compare")).toBeNull();
  });
});
