import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { signInWithGoogle, signOut } from "./google";
import { supabase } from "./supabase";

/**
 * Who is signed in, for the whole app.
 *
 * The session is read once at startup and then **only** from `onAuthStateChange`. Deriving it any
 * other way — re-reading storage on a screen, caching a token in a component — is how one part of
 * an app keeps acting as a user the rest has already signed out.
 *
 * `status` is a three-state on purpose. "Not signed in" and "we do not know yet" render the same
 * way if they share a value, so a cold start flashes the sign-in screen for a moment before the
 * stored session loads, and it looks like the app forgot who you are.
 */

export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;

    // `getSession` reads persisted storage; it does not verify the token with the auth server.
    // That is fine HERE — this only decides which screen to draw. Every claim that matters is
    // re-verified server-side in lib/auth.ts, which is the only place it can be trusted.
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });

    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status: !ready ? "loading" : session ? "signed-in" : "signed-out",
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      signInWithGoogle,
      signOut,
    }),
    [ready, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * The current access token, or null when signed out.
 *
 * Goes through `getSession()` rather than a captured value because supabase-js refreshes tokens in
 * the background: a token read at render time is stale by the time a long upload finishes, and the
 * request comes back 401 for no reason the golfer can see.
 */
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
