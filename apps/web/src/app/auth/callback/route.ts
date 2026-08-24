import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The OAuth landing — Google → Supabase → here, carrying a one-time `code`.
 *
 * The exchange runs server-side so the session lands in cookies the RSC tree can read on the
 * very next request; a client-side exchange would race the redirect to `/` and render the swing
 * log signed-out once before hydrating. The email/phone code flows never come here — they verify
 * in place and have no redirect leg, which is why this route appearing broken would not affect
 * them.
 *
 * `next` is validated to a same-origin path. An open redirect off a sign-in flow is a phishing
 * primitive — the one URL a user has been trained to trust arrives with their session and sends
 * them anywhere it likes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }

  return NextResponse.redirect(new URL("/signin", url.origin));
}
