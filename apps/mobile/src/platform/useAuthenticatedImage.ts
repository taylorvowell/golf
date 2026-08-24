import { useEffect, useState } from "react";

import { onAccessTokenRefreshed } from "../features/auth/AuthProvider";
import { api } from "./client";

/**
 * Resolve a media path into a source carrying the session, or null until it is ready.
 *
 * Asynchronous because the access token is — supabase-js refreshes in the background, so a token
 * captured at construction is stale by the first long session. Callers draw a placeholder for that
 * first render rather than mounting an image with no source.
 *
 * **Re-resolved on every token refresh.** The pair this returns is a CAPTURED credential: the
 * image component (or the native player) fetches bytes with these exact headers for as long as
 * the source is mounted, and `request()`'s ask-per-call discipline never touches that path. After
 * a refresh — most realistically while the app was backgrounded, where auto-refresh is paused and
 * catches up on return — the old headers are answered as the dev fallback identity: **404, not
 * 401**, on media that exists (D48). Re-resolving here is what keeps a long viewing session from
 * quietly turning into "this swing would not play".
 *
 * **The component this feeds must be `expo-image`, not React Native's `Image`.** RN's `Image`
 * accepts `headers` on its source and silently does not send them on Android — the request arrives
 * unauthenticated, and because a development fallback identity exists it is answered as *that*
 * user rather than refused, so the route returns 404 (no such swing for this owner) instead of
 * 401. The visible symptom is a blank image with a plausible-looking status and nothing in the
 * client to suggest authentication was ever involved. This cost a day once; it is the reason this
 * hook has one home rather than three.
 */
export interface AuthenticatedImage {
  uri: string;
  headers: Record<string, string>;
}

/**
 * The last source resolved per path, so a REMOUNT starts with a picture instead of a null frame.
 *
 * Resolution is async (the token is), which means every fresh mount used to render at least one
 * frame with no source — and on the swing page that frame is visible: the swipe's cover and the
 * player's poster both remount per swing, and each opened dark for a beat before its own image
 * arrived (Taylor, 2026-08-22, the swipe flicker). The cache seeds the FIRST render synchronously;
 * the effect still re-resolves in the background, so the cache decides what draws first, never
 * what is true — `useSwings`' own rule.
 *
 * Entries are replaced on every token refresh (the resolve below re-runs and overwrites), and the
 * map is bounded: at ~100 paths the oldest half is dropped, which at two URLs per swing is far
 * beyond a session's working set.
 */
const lastResolved = new Map<string, AuthenticatedImage>();

function remember(path: string, source: AuthenticatedImage): void {
  if (lastResolved.size > 100) {
    let drop = lastResolved.size / 2;
    for (const key of lastResolved.keys()) {
      if (drop <= 0) break;
      lastResolved.delete(key);
      drop -= 1;
    }
  }
  lastResolved.set(path, source);
}

export function useAuthenticatedImage(path: string | null): AuthenticatedImage | null {
  const [source, setSource] = useState<AuthenticatedImage | null>(() =>
    path ? (lastResolved.get(path) ?? null) : null,
  );

  useEffect(() => {
    if (!path) {
      setSource(null);
      return;
    }
    let live = true;
    // Seeded from the cache rather than blanked: clearing to null here is exactly the one-frame
    // dark flash the cache exists to remove. An uncached path still starts null via the effect's
    // own state read below.
    setSource(lastResolved.get(path) ?? null);

    const resolve = () =>
      void api
        .mediaSource(path)
        .then((s) => {
          remember(path, s);
          if (live) setSource(s);
        })
        .catch(() => {
          // A missing artifact is a real and permanent state — a swing analysed before it existed.
          // The caller draws its placeholder, which is the correct output, not a degraded one.
        });

    resolve();
    const unsubscribe = onAccessTokenRefreshed(resolve);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [path]);

  return source;
}
