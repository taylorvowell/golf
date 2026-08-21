import { act, render, renderHook } from "@testing-library/react-native";

import { ApiClientError } from "../platform/api";

/**
 * What this pins is the inbox's honesty and its ack contract, not its layout.
 *
 * Three things have to hold. A request that never reached the server must not render as "You're
 * all caught up" — that is a claim about the golfer's coach, made on the strength of a dropped
 * packet. Opening must ack exactly the rows it showed, in one batch, because a badge that
 * survives being looked at is the noise §29 exists to prevent. And the unread dots must survive
 * that ack for the viewing that triggered it — otherwise the golfer watches the thing they came
 * to read mark itself as already seen.
 */

const mockRequest = jest.fn();
const mockGoBack = jest.fn();

jest.mock("../platform/client", () => ({
  api: { request: (path: string, init?: RequestInit) => mockRequest(path, init) },
}));
jest.mock("../navigation", () => ({
  useAppNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
}));

import { NotificationsScreen } from "./NotificationsScreen";
import {
  clearNotificationsCache,
  useUnreadCount,
} from "../features/notifications/useNotifications";

function notification(over: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    kind: "analysis_ready",
    title: "Your swing is ready",
    body: "7-iron, down the line.",
    data: {},
    groupKey: null,
    count: 1,
    createdAt: Date.now() - 120_000,
    readAt: null,
    ...over,
  };
}

/** Long enough for the drawer's open slide and the fetch/ack microtasks behind it. */
async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRequest.mockReset();
  mockGoBack.mockReset();
  // The inbox store is module-level by design — it is what keeps four mounted bells agreeing.
  // Each test starts cold unless it says otherwise.
  clearNotificationsCache();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("NotificationsScreen", () => {
  it("draws the rows the server sent", async () => {
    mockRequest.mockResolvedValue({
      notifications: [notification(), notification({ id: "n-2", title: "Focus goal achieved" })],
      unreadCount: 2,
    });

    const { getByText } = await render(<NotificationsScreen />);
    await settle();

    expect(getByText("Your swing is ready")).toBeTruthy();
    expect(getByText("Focus goal achieved")).toBeTruthy();
  });

  it("acks exactly the unread rows it showed, once, in one batch", async () => {
    mockRequest.mockImplementation((path: string) =>
      path === "notifications"
        ? Promise.resolve({
            notifications: [
              notification({ id: "n-1" }),
              notification({ id: "n-2", readAt: Date.now() }),
              notification({ id: "n-3" }),
            ],
            unreadCount: 2,
          })
        : Promise.resolve({ acked: 2, unreadCount: 0 }),
    );

    await render(<NotificationsScreen />);
    await settle();

    const acks = mockRequest.mock.calls.filter(([path]) => path === "notifications/read");
    expect(acks).toHaveLength(1);
    expect(JSON.parse(acks[0][1].body)).toEqual({ ids: ["n-1", "n-3"] });
  });

  it("keeps the unread dots up while the golfer is still looking at them", async () => {
    mockRequest.mockImplementation((path: string) =>
      path === "notifications"
        ? Promise.resolve({ notifications: [notification()], unreadCount: 1 })
        : Promise.resolve({ acked: 1, unreadCount: 0 }),
    );

    const { queryAllByTestId } = await render(<NotificationsScreen />);
    await settle();

    // The ack has already landed and stamped `readAt` in the store — the dot must still be here.
    expect(queryAllByTestId("notification-unread-dot")).toHaveLength(1);
  });

  it("says nothing arrived only when the server said so", async () => {
    mockRequest.mockResolvedValue({ notifications: [], unreadCount: 0 });

    const { getByTestId } = await render(<NotificationsScreen />);
    await settle();

    expect(getByTestId("notifications-empty")).toBeTruthy();
    // Nothing to ack — an empty inbox must not POST.
    expect(mockRequest.mock.calls.filter(([p]) => p === "notifications/read")).toHaveLength(0);
  });

  it("never renders an empty inbox over a network failure", async () => {
    mockRequest.mockRejectedValue(new ApiClientError(0, "timeout", "no answer"));

    const { getByTestId, queryByTestId } = await render(<NotificationsScreen />);
    await settle();

    expect(getByTestId("notifications-unreachable")).toBeTruthy();
    expect(queryByTestId("notifications-empty")).toBeNull();
  });

  it("separates a refused session from an unreachable one", async () => {
    mockRequest.mockRejectedValue(new ApiClientError(401, "unauthorized", "declined"));

    const { getByTestId, queryByTestId } = await render(<NotificationsScreen />);
    await settle();

    expect(getByTestId("notifications-signed-out")).toBeTruthy();
    expect(queryByTestId("notifications-unreachable")).toBeNull();
  });
});

/**
 * The auth boundary, which is the one failure here a golfer could never diagnose.
 *
 * The list fetch is module-scope and shared by every bell, so it has no per-mount `liveRef` to
 * discard a late answer the way `useSwings` does. A GET authorized under the OUTGOING session can
 * still be in the air when the golfer signs out — and without a generation guard it resolves into
 * a store that has already been cleared, putting the previous account's notifications in the next
 * account's bell.
 */
describe("the inbox store across a sign-out", () => {
  it("drops a list response that arrives after the cache was cleared", async () => {
    let release: (body: unknown) => void = () => {};
    mockRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const { result } = await renderHook(() => useUnreadCount());
    await settle();

    // Sign-out lands while the GET is still in flight.
    await act(async () => {
      clearNotificationsCache();
    });

    // ...and the previous session's answer arrives afterwards.
    await act(async () => {
      release({ notifications: [notification()], unreadCount: 7 });
    });
    await settle();

    expect(result.current).toBe(0);
  });
});
