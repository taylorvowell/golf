import { act, renderHook, waitFor } from "@testing-library/react-native";

/**
 * The phone's half of the corrections merge — and specifically the STALE gate (C10).
 *
 * A stale row was placed against a different artifact clock: a re-analysis changed the fps
 * (native-rate CFR renumbers a 30fps import wholesale), so the row's frame number names the
 * wrong instant on the clip now playing. Merging it as truth would pin a phase boundary or a
 * club head one clock off — worse than the analyzer's own answer, which is exactly what the
 * fallback is. The row still exists server-side; only the render drops it.
 */

const mockRequest = jest.fn();

jest.mock("../../platform/client", () => ({
  api: {
    request: (path: string, init?: unknown) => mockRequest(path, init),
  },
}));

import { useCorrections } from "./useCorrections";

function respond(stages: unknown[], markers: unknown[]) {
  mockRequest.mockImplementation((path: string) => {
    if (path.includes("/stages")) return Promise.resolve({ stages });
    if (path.includes("/markers")) return Promise.resolve({ markers });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe("useCorrections stale rows", () => {
  beforeEach(() => mockRequest.mockReset());

  it("keeps live rows and drops stale ones, phases and marks alike", async () => {
    respond(
      [
        { stage: "impact", frame: 120 },
        { stage: "downswing_start", frame: 90, stale: true },
      ],
      [
        { frame: 100, x: 0.5, y: 0.6 },
        { frame: 101, x: 0.51, y: 0.61, stale: true },
      ],
    );
    const view = await renderHook(() => useCorrections("swing-1"));
    await act(async () => {
      await waitFor(() => expect(view.result.current.marks.size).toBe(1));
    });

    expect(view.result.current.phases).toEqual({ impact: 120 });
    expect(view.result.current.marks.get(100)).toEqual([0.5, 0.6]);
    expect(view.result.current.marks.has(101)).toBe(false);
  });

  it("tolerates servers that do not send the field at all", async () => {
    // The additive contract in the other direction: an old server's rows have no `stale`
    // key, and absence means live — never a guess.
    respond([{ stage: "impact", frame: 120 }], [{ frame: 100, x: 0.5, y: 0.6 }]);
    const view = await renderHook(() => useCorrections("swing-1"));
    await act(async () => {
      await waitFor(() => expect(view.result.current.marks.size).toBe(1));
    });
    expect(view.result.current.phases).toEqual({ impact: 120 });
  });
});
