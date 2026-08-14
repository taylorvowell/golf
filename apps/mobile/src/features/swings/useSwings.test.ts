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

import { clearSwingsCache, deleteSwing, useSwings } from "./useSwings";

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
