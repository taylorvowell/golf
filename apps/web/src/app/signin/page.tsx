"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Passwordless sign-in by emailed **code**, not by magic link.
 *
 * §4.1 requires passwordless; it does not require a link. A magic link forces an app-switch —
 * leave the app, open mail, tap a link, hope the right app reopens — and on mobile that is the
 * single biggest drop-off in onboarding, with deep links that break and links that open in the
 * wrong browser. A six-digit code is the same email and the same Supabase call, except the user
 * never leaves the screen they started on. See docs/DECISIONS.md D25.
 *
 * There is no sign-up flow because there is no such thing here: `signInWithOtp` creates the
 * account on first use. One screen, one field, no password to choose or forget.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Both, in this order. `push` navigates; `refresh` re-runs the server components with the
    // session cookie the browser client just set — without it the swing log renders from the
    // cached, signed-out RSC payload and looks empty.
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <div className="brand-lockup" aria-label="SwingSage">
          <span className="brand-mark">SS</span>
          <div>
            <p className="text-lg font-bold tracking-[-.03em]">SwingSage</p>
            <p className="text-[9px] font-semibold uppercase tracking-[.2em] text-neutral-600">
              AI Swing Coach
            </p>
          </div>
        </div>
      </div>

      {!sent ? (
        <form onSubmit={sendCode} className="kiosk-panel flex flex-col gap-3 p-5">
          <label htmlFor="email" className="text-sm font-semibold">
            Sign in with your email
          </label>
          <p className="text-xs text-neutral-500">
            We&apos;ll send a six-digit code. No password to choose, and nothing to remember.
          </p>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-line bg-raised px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-white/90 px-3 py-2 text-sm font-bold text-black disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="kiosk-panel flex flex-col gap-3 p-5">
          <label htmlFor="code" className="text-sm font-semibold">
            Enter the code sent to {email}
          </label>
          <input
            id="code"
            // `one-time-code` is what lets iOS and Android offer the code from the notification
            // without the user opening their mail app at all — the reason this beats a link.
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="rounded-lg border border-line bg-raised px-3 py-2 text-center text-lg tracking-[.4em]"
          />
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="rounded-lg bg-white/90 px-3 py-2 text-sm font-bold text-black disabled:opacity-50"
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => { setSent(false); setCode(""); setError(null); }}
            className="text-xs text-neutral-500 underline"
          >
            Use a different email
          </button>
        </form>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </main>
  );
}
