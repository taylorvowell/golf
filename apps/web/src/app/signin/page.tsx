"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatE164ForDisplay, formatPhoneAsTyped, toE164 } from "@/lib/phoneInput";

/**
 * Passwordless sign-in by emailed or texted **code**, plus Google — never a magic link.
 *
 * §4.1 requires passwordless; it does not require a link. A magic link forces an app-switch —
 * leave the app, open mail, tap a link, hope the right app reopens — and on mobile that is the
 * single biggest drop-off in onboarding, with deep links that break and links that open in the
 * wrong browser. A six-digit code is the same email and the same Supabase call, except the user
 * never leaves the screen they started on. See docs/decisions/ARCHIVE-numbered.md D25.
 *
 * There is no sign-up flow because there is no such thing here: `signInWithOtp` creates the
 * account on first use, for email and phone alike. One screen, one field, no password to choose
 * or forget. Google carries a verified email, so Supabase links it to an existing email account
 * rather than minting a second one — the one-golfer-one-account rule.
 */

type Method = "email" | "phone";

export default function SignIn() {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [e164, setE164] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      if (method === "email") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });
        if (error) throw new Error(error.message);
      } else {
        const normalized = toE164(phone);
        const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
        if (error) throw new Error(error.message);
        setE164(normalized);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } =
      method === "email"
        ? await supabase.auth.verifyOtp({ email, token: code, type: "email" })
        : await supabase.auth.verifyOtp({ phone: e164 ?? "", token: code, type: "sms" });
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

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // PKCE redirect: Google → Supabase → /auth/callback, which exchanges the code for the
    // session cookie server-side. The browser leaves this page, so busy is never unset on
    // success — only on failure to even start.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(false);
      setError(error.message);
    }
  }

  function reset() {
    setSent(false);
    setCode("");
    setE164(null);
    setError(null);
  }

  const sentTo = method === "email" ? email : formatE164ForDisplay(e164 ?? "");

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
          <div className="flex rounded-lg bg-raised p-1" role="tablist" aria-label="Sign-in method">
            {(["email", "phone"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                onClick={() => {
                  setMethod(m);
                  setError(null);
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold capitalize ${
                  method === m ? "bg-white/90 text-black" : "text-neutral-400"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <p className="text-xs text-neutral-500">
            {method === "email"
              ? "We'll email a six-digit code. No password to choose, and nothing to remember."
              : "We'll text a six-digit code. No password to choose, and nothing to remember."}
          </p>

          {method === "email" ? (
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
          ) : (
            <input
              id="phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneAsTyped(e.target.value))}
              placeholder="(555) 123-4567"
              className="rounded-lg border border-line bg-raised px-3 py-2 text-sm"
            />
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-white/90 px-3 py-2 text-sm font-bold text-black disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send code"}
          </button>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[10px] font-semibold uppercase tracking-[.2em] text-neutral-600">
              or
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            disabled={busy}
            className="rounded-lg bg-raised px-3 py-2 text-sm font-bold disabled:opacity-50"
          >
            Continue with Google
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="kiosk-panel flex flex-col gap-3 p-5">
          <label htmlFor="code" className="text-sm font-semibold">
            Enter the code sent to {sentTo}
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
          <button type="button" onClick={reset} className="text-xs text-neutral-500 underline">
            {method === "email" ? "Use a different email" : "Use a different number"}
          </button>
        </form>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </main>
  );
}
