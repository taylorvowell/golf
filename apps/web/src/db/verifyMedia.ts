import { createClient } from "@supabase/supabase-js";
import "./cliOnly";

/**
 * Every swing's media, fetched over HTTP exactly as the phone fetches it.
 *
 * Written because "the thumbnails are blank" has three unrelated causes and the repository can
 * distinguish none of them: the object is missing, the route refuses the request, or the client
 * never asked correctly. Checking the filesystem answers only the first. This asks the running
 * server, with a real session, for the same URLs the app builds — so a pass here means the
 * remaining suspect is the client, and a fail names which route and which status.
 *
 *   pnpm --filter web verify:media you@example.com [baseUrl]
 *
 * The session is minted with the admin API against an EXISTING account and nothing about that
 * account is modified — no user is created, none is deleted.
 */

const EMAIL = process.argv[2]?.trim();
const BASE_URL = process.argv[3] ?? "http://127.0.0.1:3000";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} is required. Run from apps/web with a populated .env.`);
  return v;
}

async function main() {
  if (!EMAIL) {
    throw new Error("usage: pnpm --filter web verify:media <email> [baseUrl]");
  }

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const admin = createClient(url, env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // A magic link the script consumes itself. This is the only way to obtain a session for an
  // existing OAuth account without a browser, and it neither changes the account nor invalidates
  // any session already live on a phone.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr || !link?.properties) throw new Error(`could not mint a session: ${linkErr?.message}`);

  const { data: session, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (otpErr || !session.session) throw new Error(`could not verify: ${otpErr?.message}`);
  const token = session.session.access_token;

  const cfg = await (await fetch(`${BASE_URL}/api/v1/client`)).json();
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-swingsage-client-version": (cfg as { currentVersion: string }).currentVersion,
  };

  const list = (await (await fetch(`${BASE_URL}/api/v1/swings`, { headers })).json()) as {
    swings: { id: string; label: string }[];
  };
  console.log(`${list.swings.length} swing(s) for ${EMAIL}\n`);

  let bad = 0;
  for (const s of list.swings) {
    const results: string[] = [];
    for (const [name, path] of [
      ["thumb", `swings/${s.id}/thumb`],
      // HEAD, not GET: the clip is ~30 MB and the question is only whether the route serves it.
      ["video", `swings/${s.id}/video`],
      ["analysis", `swings/${s.id}/analysis`],
    ] as const) {
      const res = await fetch(`${BASE_URL}/api/v1/${path}`, {
        headers,
        method: name === "video" ? "HEAD" : "GET",
      });
      const size = res.headers.get("content-length") ?? "?";
      const ok = res.status === 200 || res.status === 206;
      if (!ok) bad += 1;
      results.push(`${name} ${res.status}${ok ? ` (${size}B ${res.headers.get("content-type")})` : ""}`);
    }
    console.log(`${results.every((r) => /\s20[06]\b/.test(r)) ? "PASS" : "FAIL"}  ${s.label} — ${results.join(" · ")}`);
  }

  console.log(bad ? `\n${bad} media route(s) FAILED` : "\nevery media route served");
  process.exit(bad ? 1 : 0);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
