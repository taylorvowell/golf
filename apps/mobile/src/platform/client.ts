import { currentAccessToken } from "../features/auth/AuthProvider";
import { ApiClient } from "./api";

/**
 * The app's one API client, already carrying the signed-in session.
 *
 * A single instance, constructed once: a client built per screen is a place for one screen to end
 * up on a different base URL or a stale token than the rest of the app. `accessToken` is a
 * function, so this instance never holds a token — it asks for the current one per request and
 * therefore survives every background refresh.
 */

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

if (!BASE_URL) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL is not set. On a phone this must be the dev machine's LAN address " +
      "(e.g. http://10.0.1.107:3000) — `localhost` on a phone means the phone. Copy " +
      "apps/mobile/.env.example to apps/mobile/.env, then restart the bundler: Expo inlines " +
      "EXPO_PUBLIC_* at build time.",
  );
}

export const api = new ApiClient({
  baseUrl: BASE_URL,
  accessToken: currentAccessToken,
});
