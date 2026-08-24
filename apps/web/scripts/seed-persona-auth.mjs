#!/usr/bin/env node
/**
 * Create (or find) the persona demo accounts on the AUTH project.
 *
 * One real Supabase auth user per debug persona, password sign-in, email pre-confirmed —
 * these are the accounts the mobile persona picker actually signs in as
 * (`apps/mobile/src/features/debug/persona.tsx`, which owns the email ↔ persona mapping;
 * the list here must match it exactly).
 *
 * Idempotent: an existing account (matched by email) is updated in place — password and
 * name set to the current values — never duplicated.
 *
 * Env (from apps/web/.env via --env-file):
 *   NEXT_PUBLIC_SUPABASE_URL   the auth project (golf-swing in dev)
 *   SUPABASE_SECRET_KEY        its service key
 *   PERSONA_PASSWORD           the one shared password for every persona account
 *
 * Run:  node --env-file=.env scripts/seed-persona-auth.mjs
 * Prints one JSON line per account: { persona, email, id } — the ids are what the DB seed
 * and the media publisher key everything on.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const password = process.env.PERSONA_PASSWORD;
if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY required");
if (!password || password.length < 12) throw new Error("PERSONA_PASSWORD (>=12 chars) required");

/** Must match PERSONA_ACCOUNTS in apps/mobile/src/features/debug/persona.tsx. */
const ACCOUNTS = [
  { persona: "new-user", email: "persona-new@swingsage.dev", fullName: "Jordan Lee" },
  { persona: "newby", email: "persona-newby@swingsage.dev", fullName: "Priya Nair" },
  { persona: "existing", email: "persona-existing@swingsage.dev", fullName: "Marcus Webb" },
  { persona: "trial", email: "persona-trial@swingsage.dev", fullName: "Danny Ortiz" },
  { persona: "pro", email: "persona-pro@swingsage.dev", fullName: "Sophie Chen" },
  { persona: "coach", email: "persona-coach@swingsage.dev", fullName: "Dave Kim" },
  { persona: "admin", email: "persona-admin@swingsage.dev", fullName: "Alex Morgan" },
];

const admin = createClient(url, secret, { auth: { persistSession: false } });

async function findByEmail(email) {
  // Paged scan — the dev project has a handful of users, one page is the whole list.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
}

for (const account of ACCOUNTS) {
  const existing = await findByEmail(account.email);
  let id;
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });
    if (error) throw new Error(`${account.email}: ${error.message}`);
    id = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });
    if (error) throw new Error(`${account.email}: ${error.message}`);
    id = data.user.id;
  }
  console.log(JSON.stringify({ persona: account.persona, email: account.email, id }));
}
