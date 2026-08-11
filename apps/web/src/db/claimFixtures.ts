import { sql } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";
import { DEV_USER_ID } from "../lib/devIdentity";

/**
 * Hand the pre-auth development fixtures to a named account, once.
 *
 * Before step 04 every swing was owned by a seeded "admin" row. That row is gone, but the ten
 * analysed fixtures on this machine still point at it, and without this they are invisible now
 * that identity is real — row-level security correctly hides swings belonging to a user nobody can
 * sign in as.
 *
 * **Two pre-auth owners, not one.** The seeded `admin` row was the original; `DEV_USER_EMAIL`
 * (`lib/auth.ts`) then became the local identity and now owns whatever has been analysed since.
 * Claiming only the first is how the fixtures end up stranded on an identity that disappears with
 * the fallback — the script reports "nothing to claim" and everything looks fine.
 *
 * This used to run inside `requireUserId`, handing the fixtures to whoever signed in first. Two
 * things were wrong with that. It is a **privilege grant**, and the runbook tells you to browse
 * the dev server from a phone over the LAN, so "first" is not necessarily you. And it needed
 * elevation on a request path, which is exactly what D26 says must not exist: reassigning
 * `swings.user_id` away from another user is not something any policy will ever allow, so it can
 * only be done by the owner role. As a script, the elevation lives where elevation is legitimate
 * and the grant is deliberate rather than a race.
 *
 *   pnpm --filter web db:claim-fixtures you@example.com
 */
async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    throw new Error(
      "usage: pnpm --filter web db:claim-fixtures <email>\n" +
        "Moves every swing owned by a pre-auth identity (the legacy 'admin' row, or the " +
        "DEV_USER_EMAIL development user) onto that account, then deletes those rows. Sign in " +
        "once with a real provider first so the account exists.",
    );
  }

  const moved = await withOwner("one-shot local migration of pre-auth fixtures", async (tx) => {
    const owner = await tx.execute<{ id: string }>(
      sql`select id from public.users where lower(email) = lower(${email}) limit 1`,
    );
    if (!owner[0]) {
      throw new Error(
        `no user with email ${email}. Sign in through the app once so the profile row exists.`,
      );
    }

    // Refusing to claim onto a pre-auth identity is the guard that matters: running this with
    // DEV_USER_EMAIL's address would delete the row it just moved everything onto.
    if (owner[0].id === DEV_USER_ID) {
      throw new Error(
        `${email} resolves to the DEVELOPMENT identity, not a real account. Sign in with a real ` +
          "provider first, then claim onto that account.",
      );
    }

    // One statement: the delete and the reassignment cannot half-apply, so there is no state in
    // which a pre-auth row is gone and its swings are orphaned.
    const rows = await tx.execute<{ id: string }>(sql`
      with legacy as (
        delete from public.users
         where display_name = 'admin' or id = ${DEV_USER_ID}
        returning id
      )
      update public.swings set user_id = ${owner[0].id}
       where user_id in (select id from legacy)
      returning id
    `);
    return rows.length;
  });

  console.log(
    moved ? `moved ${moved} swing(s) to ${email}` : "nothing to claim — no pre-auth owner rows",
  );
  await endOwnerPool();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
