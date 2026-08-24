import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DismissalListResponse, DismissalSaveResponse } from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import { supabase } from "../auth/supabase";

/**
 * The client half of the generic dismissal store (`/api/v1/dismissals`) — "seen it, never
 * again", on any device. Nothing here knows what a spotlight is; keys are namespaced
 * strings (`spotlight.multiview.v1`) and any future one-time surface uses the same hook.
 *
 * Three properties carry the design:
 *
 *   1. **A dismissed card never flashes back.** The key set is mirrored to AsyncStorage and
 *      the hook answers `loading` until the mirror has been read — rendering nothing beats
 *      rendering a card the golfer dismissed yesterday and yanking it away when the server
 *      answers. After the mirror loads, server sync only ever ADDS keys (union), because
 *      dismissed-ness only grows: the product never un-dismisses, a reworked card is a new
 *      key, and the one true removal (the debug reset) goes through `resetDismissals`.
 *   2. **`dismiss()` is optimistic and durable.** Local set + mirror write immediately; the
 *      POST runs behind it, and a failed POST parks the key in the mirror's `pending` queue
 *      to replay on the next sync. A dismissal made in a dead zone survives an app restart
 *      and reaches the server later — it is never lost and never blocks UI.
 *   3. **One store, module scope** (the `useNotifications` shape): every subscriber shares
 *      one key set and one in-flight sync, and the auth boundary clears it — a mirror
 *      outliving its session would hide another account's cards on a shared device.
 */

const STORAGE_KEY = "swingsage.dismissals.v1";

interface Mirror {
  keys: string[];
  /** Dismissed locally, not yet confirmed by the server — replayed on every sync. */
  pending: string[];
}

export type DismissalsState =
  | { kind: "loading" }
  | { kind: "ready"; keys: ReadonlySet<string> };

let keys = new Set<string>();
let pending = new Set<string>();
/** False until the AsyncStorage mirror has been read — the no-flash gate. */
let mirrorLoaded = false;
let mirrorLoading: Promise<void> | null = null;

const listeners = new Set<() => void>();
function publish(): void {
  for (const listener of listeners) listener();
}

/** Serialized mirror writes — a burst of dismissals must not interleave stale snapshots. */
let mirrorWrite: Promise<void> = Promise.resolve();
function persistMirror(): void {
  const snapshot: Mirror = { keys: [...keys], pending: [...pending] };
  mirrorWrite = mirrorWrite
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)))
    .catch(() => undefined);
}

async function loadMirror(): Promise<void> {
  if (mirrorLoaded) return;
  mirrorLoading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      // Typed at the read site, not trusted: a corrupt mirror degrades to empty — the
      // harmless direction (a dismissed card reappearing once beats a crash at boot).
      const parsed = JSON.parse(raw) as Partial<Mirror>;
      if (Array.isArray(parsed.keys)) {
        for (const k of parsed.keys) if (typeof k === "string") keys.add(k);
      }
      if (Array.isArray(parsed.pending)) {
        for (const k of parsed.pending) if (typeof k === "string") pending.add(k);
      }
    })
    .catch(() => undefined)
    .then(() => {
      mirrorLoaded = true;
    });
  await mirrorLoading;
}

/** Same guard as `useNotifications`: a sync in the air across sign-out must not publish. */
let generation = 0;

/** The auth-boundary reset — a shared device must not inherit the previous account's keys. */
export function clearDismissalsCache(): void {
  generation += 1;
  keys = new Set();
  pending = new Set();
  mirrorLoaded = false;
  mirrorLoading = null;
  inFlight = null;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  publish();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") clearDismissalsCache();
});

let inFlight: Promise<void> | null = null;

/**
 * Sync with the server: replay anything pending, then union its answer in. Failures are
 * silent — the mirror already shows every dismissal this device knows about, and the queue
 * keeps anything unconfirmed for the next attempt.
 */
async function syncDismissals(): Promise<void> {
  if (inFlight) return inFlight;
  const mine = generation;

  inFlight = (async () => {
    try {
      await loadMirror();
      if (mine !== generation) return;

      for (const key of [...pending]) {
        await api.request<DismissalSaveResponse>("dismissals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        if (mine !== generation) return;
        pending.delete(key);
      }

      const body = await api.request<DismissalListResponse>("dismissals");
      if (mine !== generation) return;
      for (const key of body.keys) keys.add(key);
      persistMirror();
      publish();
    } catch {
      // Offline or signed out: the mirror is the answer until the next sync. A 401 is not
      // worth a distinct state here — an unauthenticated session never renders the surfaces
      // these keys hide.
    } finally {
      if (mine === generation) inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Record a dismissal: hidden immediately, mirrored immediately, confirmed eventually.
 * Callable from module scope (list-item callbacks) — no hook required.
 */
export function dismissKey(key: string): void {
  if (keys.has(key)) return;
  keys.add(key);
  pending.add(key);
  persistMirror();
  publish();

  void api
    .request<DismissalSaveResponse>("dismissals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    })
    .then(() => {
      pending.delete(key);
      persistMirror();
    })
    .catch(() => {
      // Stays in `pending`; the next sync replays it. The card stays hidden regardless —
      // resurfacing it over a network blip would read as the dismiss button not working.
    });
}

/**
 * The debug-menu reset: server rows (dev-only DELETE), mirror, and memory. Everything
 * comes back. `__DEV__` tooling — the product itself never un-dismisses.
 */
export async function resetDismissals(): Promise<void> {
  try {
    await api.request<DismissalSaveResponse>("dismissals", { method: "DELETE" });
  } catch {
    // Local state still resets — on glass the cards return either way, and the server rows
    // (if unreachable) simply re-hide them on the next sync, which is honest.
  }
  generation += 1;
  keys = new Set();
  pending = new Set();
  mirrorLoaded = true;
  mirrorLoading = null;
  inFlight = null;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  publish();
}

/**
 * Subscribe to the dismissed-key set. `loading` until the mirror has been read — render
 * nothing, not everything, while the answer is unknown.
 */
export function useDismissals(): DismissalsState {
  const [, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    listeners.add(onChange);
    void syncDismissals().then(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return mirrorLoaded ? { kind: "ready", keys } : { kind: "loading" };
}
