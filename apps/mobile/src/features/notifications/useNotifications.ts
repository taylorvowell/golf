import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type {
  Notification,
  NotificationAckResponse,
  NotificationListResponse,
} from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";
import { reportUpgradeRequired, upgradeDetailOf } from "../../platform/VersionGate";
import { supabase } from "../auth/supabase";

/**
 * The §29 inbox, client side — one store behind both surfaces the golfer sees.
 *
 * The bell and the drawer are the SAME data, and the server already answers list and unread
 * count in a single response precisely so the bell never costs its own round trip. Two
 * independent fetchers would reintroduce exactly the second call the route was shaped to avoid,
 * and would let the badge and the list disagree on screen.
 *
 * So the fetch lives at MODULE scope, not in the hook. A bell is mounted in the header of every
 * tab; per-hook fetching would mean four requests on every foreground, four cache writes racing
 * each other, and a count that depends on which one answered last. One store, one in-flight
 * request, many subscribers.
 *
 * The state is a discriminated union for the reason `useSwings` documents at length: `{ loading,
 * error, data }` permits an empty list rendering next to an unacknowledged failure, which draws
 * "You're all caught up" at somebody whose phone merely lost signal. `signed-out` is separate
 * from `unreachable` because only one of them is fixed by signing in again.
 *
 * **No poller.** §29's whole constraint is "without becoming noisy", and a timer that wakes the
 * radio for a surface that changes a few times a day is battery spent on nothing. Freshness
 * comes from three moments that already exist — mount, app foreground, opening the drawer — and
 * from push (step 05), which is the real answer to "tell me immediately".
 */

export type NotificationsState =
  | { kind: "loading" }
  | { kind: "ok"; notifications: Notification[]; unreadCount: number }
  | { kind: "signed-out" }
  | { kind: "unreachable" };

export interface NotificationsHook {
  state: NotificationsState;
  /** True during an explicit refresh — must NOT blank a list already on screen. */
  refreshing: boolean;
  refresh: () => void;
  /** Ack specific rows (what the drawer just showed). No-op on an empty list. */
  ack: (ids: string[]) => void;
  /** Ack everything unread — the drawer's "Mark all read". */
  ackAll: () => void;
}

export interface InboxCache {
  notifications: Notification[];
  unreadCount: number;
}

/**
 * The last inbox the server confirmed, plus whatever non-ok state replaced it.
 *
 * Held here rather than per-hook so the header on Home and the header on Progress cannot hold
 * different unread counts. Reset on sign-out — a cached inbox outliving its session is a leak
 * across the auth boundary.
 */
let store: NotificationsState = { kind: "loading" };
let lastGood: InboxCache | null = null;

const listeners = new Set<() => void>();
function publish(next: NotificationsState): void {
  store = next;
  for (const listener of listeners) listener();
}

/**
 * Which session's data the store is allowed to accept.
 *
 * A request authorized under the OUTGOING session can still be in the air when the golfer signs
 * out, and it resolves into a store that has already been cleared — publishing the previous
 * account's inbox into the next one's bell. `useSwings` is protected from this by its per-mount
 * `liveRef`; a module-scope fetch shared by every subscriber has no mount to hang that on, so the
 * generation is the equivalent: `clearNotificationsCache` bumps it, and a response whose captured
 * generation is stale is dropped instead of published.
 */
let generation = 0;

/** The auth-boundary hook and the tests' reset seam — never a per-screen convenience. */
export function clearNotificationsCache(): void {
  generation += 1;
  lastGood = null;
  // Abort as well as invalidate: the generation check makes a late response harmless, and the
  // abort stops paying for the body download and JSON parse of an answer already discarded.
  inFlightAbort?.abort();
  inFlightAbort = null;
  inFlight = null;
  publish({ kind: "loading" });
}

/**
 * Seed the inbox directly. `__DEV__` only — the debug panel's forced states write here, so the
 * bell and the drawer show the same forced world exactly as a real fetch would.
 */
export function seedNotifications(next: NotificationsState): void {
  lastGood = next.kind === "ok" ? { notifications: next.notifications, unreadCount: next.unreadCount } : null;
  publish(next);
}

// Module scope, like `useSwings` — SIGNED_OUT fires on explicit sign-out and between two
// different users' sessions, which is precisely when one golfer's inbox must not survive into
// another's bell.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") clearNotificationsCache();
});

/**
 * The one in-flight list request, shared by every caller.
 *
 * Four bells mounting at once is normal (the tab navigator keeps its screens alive), and four
 * simultaneous GETs would differ only in which one lost the race to write the cache.
 */
let inFlight: Promise<void> | null = null;
let inFlightAbort: AbortController | null = null;

async function fetchInbox(): Promise<void> {
  if (inFlight) return inFlight;
  if (!lastGood && store.kind !== "loading") publish({ kind: "loading" });

  const mine = generation;
  const controller = new AbortController();
  inFlightAbort = controller;

  inFlight = (async () => {
    try {
      const body = await api.request<NotificationListResponse>("notifications", {
        signal: controller.signal,
      });
      // Signed out (or reset) while this was in the air — the answer belongs to a session the
      // store no longer represents.
      if (mine !== generation) return;
      lastGood = { notifications: body.notifications, unreadCount: body.unreadCount };
      publish({ kind: "ok", ...lastGood });
    } catch (err) {
      if (mine !== generation || controller.signal.aborted) return;
      // A 426 is the server refusing this build, not a network problem — it must become the
      // upgrade screen rather than a badge that never loads.
      if (err instanceof ApiClientError && err.isUpgradeRequired) {
        reportUpgradeRequired(upgradeDetailOf(err));
        return;
      }
      if (err instanceof ApiClientError && err.status === 401) {
        lastGood = null;
        publish({ kind: "signed-out" });
      } else if (!lastGood) {
        // With a confirmed inbox on hand a failed revalidate keeps drawing it — stale beats an
        // error screen about rows the device demonstrably has. Without one, be honest.
        publish({ kind: "unreachable" });
      }
    } finally {
      if (inFlightAbort === controller) inFlightAbort = null;
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Ack, then take the server's `unreadCount` as the truth.
 *
 * The badge is NOT decremented locally. Two devices share one inbox and acks race, so the count
 * after an ack is a server fact; a local guess is how a bell ends up reading 2 while the drawer
 * under it shows nothing unread. `readAt` on the rows we asked about is stamped locally in the
 * same write, because that is a claim the server just confirmed.
 *
 * A failed ack is silent by design: the rows are still there, still unread, and the next refresh
 * says so. "We could not mark these read" is an error about our bookkeeping, not about anything
 * the golfer was doing.
 */
async function ackTargets(target: { ids: string[] } | { all: true }): Promise<void> {
  const now = Date.now();
  const mine = generation;
  try {
    const body = await api.request<NotificationAckResponse>("notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("all" in target ? { all: true } : { ids: target.ids }),
    });
    // Same auth-boundary guard as the list fetch — an ack that lands after sign-out must not
    // write the previous session's rows back into a cleared store.
    if (mine !== generation || !lastGood) return;
    const hit = "all" in target ? null : new Set(target.ids);
    lastGood = {
      notifications: lastGood.notifications.map((n) =>
        n.readAt === null && (hit === null || hit.has(n.id)) ? { ...n, readAt: now } : n,
      ),
      unreadCount: body.unreadCount,
    };
    publish({ kind: "ok", ...lastGood });
  } catch {
    /* see above — deliberately silent */
  }
}

/**
 * Subscribe to the store, and keep it fresh. EVERY consumer of the inbox goes through this —
 * which is the point: the freshness rules belong to the store, not to whichever hook happens to
 * be mounted.
 *
 * Both halves of that live here for a reason found in review. The bell is the thing on screen;
 * the drawer is open for seconds at a time. Hanging the foreground refresh off the drawer's hook
 * meant it only ever fired while the inbox was ALREADY open — the exact opposite of the case it
 * exists for, which is a push landing while the app was backgrounded and the badge still showing
 * yesterday's count.
 *
 * `AppState` is subscribed per mount rather than once at module scope so it is removed when the
 * last consumer unmounts; `fetchInbox` collapses the resulting simultaneous calls into one
 * request, so N mounted bells still cost one GET.
 */
function useInboxStore(): NotificationsState {
  const [state, setState] = useState<NotificationsState>(store);
  useEffect(() => {
    const onChange = () => setState(store);
    listeners.add(onChange);
    onChange();
    void fetchInbox();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void fetchInbox();
    });
    return () => {
      listeners.delete(onChange);
      sub.remove();
    };
  }, []);
  return state;
}

/**
 * The full inbox — the drawer's hook. Freshness comes from `useInboxStore`; this adds the ack
 * surface and the explicit-refresh flag.
 */
export function useNotifications(): NotificationsHook {
  const state = useInboxStore();
  const [refreshing, setRefreshing] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchInbox().finally(() => {
      if (live.current) setRefreshing(false);
    });
  }, []);

  return {
    state,
    refreshing,
    refresh,
    ack: useCallback((ids: string[]) => {
      if (ids.length > 0) void ackTargets({ ids });
    }, []),
    ackAll: useCallback(() => void ackTargets({ all: true }), []),
  };
}

/**
 * Just the badge number — what the header bell needs and nothing else.
 *
 * Separate from `useNotifications` so a bell carries no ack surface it will never call, and so
 * chrome mounted on four tabs is four subscriptions to one store rather than four inboxes. It
 * gets mount and foreground refresh from the store, same as the drawer.
 */
export function useUnreadCount(): number {
  const state = useInboxStore();
  return state.kind === "ok" ? state.unreadCount : 0;
}
