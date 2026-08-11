import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out of THIS device only.
 *
 * `scope: "local"` is deliberate and is a §4.2 requirement, not a default: the same account must
 * stay signed in on several phones at once, because multi-phone synchronized capture (§12)
 * depends on it. A global sign-out here would silently break the product's stated differentiator
 * by ending the other device's session too.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(
    new URL("/signin", process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"),
  );
}
