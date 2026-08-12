import { sql } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";
import { DEV_USER_ID } from "../lib/devIdentity";
import { ADMIN_USER_ID } from "./seed";
import { ARTIFACT_BUCKET, SOURCE_BUCKET, userPrefix } from "../lib/media/keys";
import { getMediaStore } from "../lib/media/store";

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

    // Which owners are about to disappear, read BEFORE the delete — their ids are the media
    // prefixes that have to be re-homed afterwards, and after the statement below they are gone.
    const legacy = await tx.execute<{ id: string }>(sql`
      select id from public.users where display_name = 'admin' or id = ${DEV_USER_ID}
    `);

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
    return { count: rows.length, newOwner: owner[0].id, oldOwners: legacy.map((r) => r.id) };
  });

  console.log(
    moved.count
      ? `moved ${moved.count} swing(s) to ${email}`
      : "nothing to claim — no pre-auth owner rows",
  );

  /**
   * **The media has to move with the ownership.**
   *
   * A storage key leads with the owner's id (D33: `u/<userId>/s/<swingId>/v/<viewId>/...`), so
   * reassigning `swings.user_id` silently repoints every artifact at a namespace nothing was ever
   * published to. The symptom is not an error — it is a swing log full of real swings with no
   * thumbnails and no video, because each key resolves to an object that is not there.
   *
   * This ran for the first time on 2026-08-12 without this block and did exactly that. It was
   * caught by `multiView.test.ts`, which asserts every ready view resolves to a published
   * `analysis.json` — a test written for a different reason entirely.
   */
  // Runs whether or not any row moved, and that is deliberate: the first version of this script
  // reassigned the rows and left the media behind, so the state it produced has no legacy owner
  // row left to key off. Sweeping the known pre-auth prefixes unconditionally makes re-running the
  // command the repair, rather than requiring a one-off script nobody will find again.
  const store = await getMediaStore();
  const stale = new Set([...moved.oldOwners, DEV_USER_ID, ADMIN_USER_ID]);
  stale.delete(moved.newOwner);
  let objects = 0;
  for (const bucket of [SOURCE_BUCKET, ARTIFACT_BUCKET]) {
    for (const old of stale) {
      objects += await store.movePrefix(bucket, userPrefix(old), userPrefix(moved.newOwner));
    }
  }
  console.log(
    objects
      ? `re-homed ${objects} media object(s) onto ${email}'s prefix`
      : "no media left under a pre-auth prefix",
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
