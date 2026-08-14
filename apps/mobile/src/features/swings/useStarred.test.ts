import { act, renderHook, waitFor } from "@testing-library/react-native";

import { clearStarredCache, useStarred } from "./useStarred";

/**
 * The star is device-local until the contract grows the field — what is pinned is that it
 * behaves like a fact anyway: it survives a remount (the persisted set reloads), and toggling
 * one swing says nothing about another.
 */

beforeEach(() => {
  clearStarredCache();
});

it("stars, unstars, and keeps the two swings apart", async () => {
  const a = await renderHook(() => useStarred("s-1"));
  const b = await renderHook(() => useStarred("s-2"));
  await waitFor(() => expect(a.result.current.starred).toBe(false));

  await act(async () => a.result.current.toggle());
  await waitFor(() => expect(a.result.current.starred).toBe(true));
  expect(b.result.current.starred).toBe(false);

  await act(async () => a.result.current.toggle());
  await waitFor(() => expect(a.result.current.starred).toBe(false));
});

it("survives a cold start from storage", async () => {
  const first = await renderHook(() => useStarred("s-1"));
  await waitFor(() => expect(first.result.current.starred).toBe(false));
  await act(async () => first.result.current.toggle());
  await waitFor(() => expect(first.result.current.starred).toBe(true));
  first.unmount();

  // A new session: the in-memory set is gone, the persisted one is not.
  clearStarredCache();
  const second = await renderHook(() => useStarred("s-1"));
  await waitFor(() => expect(second.result.current.starred).toBe(true));
});
