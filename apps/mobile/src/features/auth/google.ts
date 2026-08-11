import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import { supabase } from "./supabase";

/**
 * Google sign-in, native. No browser, no redirect, no app-switch.
 *
 * The phone asks Google for an **ID token** and hands that token to Supabase. Nothing here talks
 * to a web page, which is the whole reason D31 chose it: an OAuth round trip through the system
 * browser is the app-switch D25 rejected magic links over, wearing a different hat.
 *
 * **Only the WEB client id appears in this file, and that is correct.** Google mints the ID token
 * with `aud` = the web client and `azp` = the Android client; Supabase validates `aud` against the
 * client id configured on its Google provider, which is the web one. The Android OAuth client is
 * still required — it is what binds this package name and signing key to the Google Cloud project —
 * but it is matched by the *signature of the calling app*, never by a value in the bundle. Passing
 * the Android id here produces a token Supabase rejects with no useful error, which is exactly the
 * mistake `.env.example` warns about.
 */

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

/** Distinguishes "the golfer changed their mind" from "sign-in is broken". */
export class GoogleSignInCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "GoogleSignInCancelled";
  }
}

/**
 * Called before every sign-in rather than once at startup.
 *
 * `GoogleSignin.configure` is synchronous, cheap and safe to repeat, so there is no cached flag to
 * get out of step with reality. Doing it lazily also keeps a missing client id from taking the
 * whole app down at import — the golfer sees a sign-in screen that explains the problem instead of
 * a bundle that will not load.
 */
export function configureGoogleSignIn(): void {
  if (!WEB_CLIENT_ID) {
    throw new Error(
      "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. It is the *web* OAuth client id from Google " +
        "Cloud Console — not the Android one — and it must match the client id configured on the " +
        "Supabase project's Google provider.",
    );
  }
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ["profile", "email"] });
}

/**
 * Sign in with Google and exchange the result for a Supabase session.
 *
 * Throws `GoogleSignInCancelled` when the golfer dismisses the sheet, so a caller can stay silent
 * for that and only show an error for a real failure. Presenting "sign-in failed" after someone
 * deliberately backed out is the kind of small lie that makes an app feel broken.
 */
export async function signInWithGoogle(): Promise<void> {
  configureGoogleSignIn();

  // Android only, and it resolves `true` everywhere else. Without it, a device with outdated or
  // missing Play Services fails inside `signIn()` with an error nobody can act on.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let response;
  try {
    response = await GoogleSignin.signIn();
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new GoogleSignInCancelled();
    }
    throw err;
  }

  if (!isSuccessResponse(response)) throw new GoogleSignInCancelled();

  const idToken = response.data.idToken;
  if (!idToken) {
    // Reached when `webClientId` is missing or wrong: Google returns a user with no ID token at
    // all rather than an error, so without this the failure surfaces later as "not signed in".
    throw new Error(
      "Google returned no ID token. That almost always means EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is " +
        "wrong, or the Android OAuth client's SHA-1 does not match the key this build was signed " +
        "with.",
    );
  }

  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken });
  if (error) throw error;
}

/**
 * Sign out of THIS device only.
 *
 * `scope: "local"` is a §4.2 requirement, not a default — the same account must stay signed in on
 * several phones at once because multi-phone synchronized capture (§12) depends on it. A global
 * sign-out here would end the other phone's session and silently break the differentiator.
 *
 * Google's own cached credential is cleared too. Leaving it means the next "Sign in with Google"
 * silently reuses the previous account with no chooser, which reads as the app ignoring the tap.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
  try {
    await GoogleSignin.signOut();
  } catch {
    // Never block sign-out on the Google SDK. The Supabase session is what authorizes a request;
    // if that is gone, the golfer is signed out of SwingSage whatever Google still remembers.
  }
}
