import { createBrowserClient } from "@supabase/ssr";

/** Browser-side client. Publishable key only — it is designed to be public and RLS is what
 *  actually protects the data behind it. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
