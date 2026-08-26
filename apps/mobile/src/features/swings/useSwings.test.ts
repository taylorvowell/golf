import { renderHook, waitFor } from "@testing-library/react-native";

/**
 * Deletion's contract with the cache: the swing leaves the module cache only after the server
 * confirmed, and every *mounted* log hears about it — the log screen stays alive under the stack
 * while the player deletes, and a log still showing a deleted swing reads as the delete failing.
 */

const mockRequest = jest.fn();

jest.mock("../../platform/client", () => ({
  api: {
    request: (path: string, init?: RequestInit) => mockRequest(path, init),
    mediaSource: async (path: string) => ({ uri: `http://test/${path}`, headers: {} }),
  },
}));

import { clearSwingsCache, deleteSwing, setSwingFavourite, useSwings } from "./useSwings";

function swing(id: string) {
  return { id, label: id, views: [], overallScore: null };
}

beforeEach(() => {
  mockRequest.mockReset();
  clearSwingsCache();
});

it("drops a deleted swing from every mounted log, but only once the server confirmed", async () => {
  mockRequest.mockResolvedValue({ swings: [swing("s-1"), swing("s-2")] });
  const { result } = await renderHook(() => useSwings());
  await waitFor(() => expect(result.current.state.kind).toBe("ok"));

  mockRequest.mockResolvedValue({ swingId: "s-1", mediaObjects: 3 });
  await deleteSwing("s-1");

  expect(mockRequest).toHaveBeenLastCalledWith(
    "swings/s-1",
    expect.objectContaining({ method: "DELETE" }),
  );
  await waitFor(() => {
    expect(result.current.state).toEqual({ kind: "ok", swings: [swing("s-2")] });
  });
});

it("keeps the swing when the delete never reached the server", async () => {
  mockRequest.mockResolvedValue({ swings: [swing("s-1")] });
  const { result } = await renderHook(() => useSwings());
  await waitFor(() => expect(result.current.state.kind).toBe("ok"));

  mockRequest.mockRejectedValue(new Error("network down"));
  await expect(deleteSwing("s-1")).rejects.toThrow("network down");

  // Not optimistic, deliberately: a swing that vanished on a failed delete would reappear on the
  // next refresh and read as a bug — or worse, never be retried.
  expect(result.current.state).toEqual({ kind: "ok", swings: [swing("s-1")] });
});

/**
 * Starring goes the OTHER way from deletion, and the asymmetry is the point: a star is a toggle
 * whose job is instant feedback and whose worst failure is a filled star that empties again, so
 * it flips the cache first. What must hold is that a failure restores the value that was there —
 * not a blind flip back, which would clobber a second tap that landed while the first was away.
 */
describe("starring a swing", () => {
  it("fills the star at once, then takes the server's confirmed row", async () => {
    mockRequest.mockResolvedValue({ swings: [swing("s-1"), swing("s-2")] });
    const { result } = await renderHook(() => useSwings());
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));

    let resolvePatch: (v: unknown) => void = () => {};
    mockRequest.mockReturnValue(new Promise((res) => { resolvePatch = res; }));
    const inFlight = setSwingFavourite("s-1", true);

    // Optimistic: drawn before the request has answered anything.
    await waitFor(() => {
      expect(current(result, "s-1")?.favourite).toBe(true);
    });
    expect(mockRequest).toHaveBeenLastCalledWith(
      "swings/s-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ favourite: true }) }),
    );

    // The CONFIRMED row wins, even where it disagrees — here the server also carries a score the
    // optimistic copy never had, which a blind local flip would have discarded.
    resolvePatch({ swing: { ...swing("s-1"), favourite: true, overallScore: 61.6 } });
    await inFlight;
    await waitFor(() => {
      expect(current(result, "s-1")?.overallScore).toBe(61.6);
    });
  });

  it("puts the star back exactly as it was when the write never landed", async () => {
    mockRequest.mockResolvedValue({
      swings: [{ ...swing("s-1"), favourite: true }],
    });
    const { result } = await renderHook(() => useSwings());
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));

    mockRequest.mockRejectedValue(new Error("network down"));
    await expect(setSwingFavourite("s-1", false)).rejects.toThrow("network down");

    // Restored to TRUE — the value it held — rather than toggled back to whatever it now shows.
    await waitFor(() => {
      expect(current(result, "s-1")?.favourite).toBe(true);
    });
  });
});

function current(
  result: { current: { state: { kind: string; swings?: Array<{ id: string }> } } },
  id: string,
) {
  const state = result.current.state as { kind: string; swings?: Array<Record<string, unknown>> };
  return state.swings?.find((s) => s.id === id) as
    | { favourite?: boolean; overallScore?: number | null }
    | undefined;
}
