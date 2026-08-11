import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for server components, route handlers and the proxy.
 *
 * Only the PUBLISHABLE key is ever used here. The service-role key bypasses every RLS policy in
 * migration 0003, so it must never be reachable from request handling — `src/db/service-role.test.ts`
 * fails the build if it appears anywhere under `src/app` or `src/components`.
 */
export async function createClient() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Components cannot set cookies. The proxy refreshes the session on every
            // request, so ignoring this is safe rather than merely convenient.
          }
        },
      },
    },
  );
}
