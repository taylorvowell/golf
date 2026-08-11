import { AppState } from "react-native";
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The phone's connection to Supabase Auth. Identity only — this client never reads swing data.
 *
 * Everything the product knows about a golfer is reached through our own API (`platform/api.ts`),
 * which enforces entitlement and row-level security on the caller's behalf. PostgREST is not used
 * from the device and must not be: a mobile binary is an untrusted client, so the boundary has to
 * live on the server side of the request (D7, D16, D17).
 *
 * Three settings are load-bearing:
 *
 *   * **`storage: AsyncStorage`** — without it the session lives in memory and every cold start is
 *     a fresh sign-in. §4.2 requires a session that survives app restart.
 *   * **`detectSessionInUrl: false`** — that flag is for a browser returning from a redirect. There
 *     is no URL here, and leaving it on makes the client parse a deep link as an auth callback.
 *   * **`lock: processLock`** — two screens refreshing an expiring token at once otherwise both
 *     spend the same single-use refresh token, and the loser is signed out. React Native has no
 *     `navigator.locks`, so supabase-js needs this one handed to it explicitly.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required. Copy " +
      "apps/mobile/.env.example to apps/mobile/.env and fill them in — Expo inlines EXPO_PUBLIC_* " +
      "at BUILD time, so a value added after the bundler started will not appear until it restarts.",
  );
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

/**
 * Refresh the access token only while the app is on screen.
 *
 * A backgrounded app cannot usefully refresh anything, and a timer that keeps firing there is
 * battery spent for nothing. Registered once, at module scope, because two registrations means two
 * refresh loops racing for the same single-use refresh token.
 *
 * Returns the subscription so a test can detach it; nothing in the app needs to.
 */
export const appStateSubscription = AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
