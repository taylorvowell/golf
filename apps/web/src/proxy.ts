import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh on every request.
 *
 * **This file is `proxy.ts`, not `middleware.ts`.** Next.js 16 renamed Middleware to Proxy; a
 * file called `middleware.ts` is simply never executed, and the failure mode is an app that looks
 * fine while nobody's session is ever refreshed.
 *
 * It refreshes tokens and nothing else. Next's own docs are explicit that the proxy is not a
 * session-management or authorization solution — authorization here is RLS in the database, and
 * identity is resolved per-request in `lib/auth.ts` with `getUser()`, which verifies the token
 * with Supabase rather than trusting a cookie.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Touching the user is what triggers the refresh. Do not remove it as "unused".
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Everything except static assets and the media route, which streams video and must not pay
  // for a token refresh on every range request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/swings/.*/video).*)"],
};
