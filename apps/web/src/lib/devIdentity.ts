/**
 * The development fallback identity, as two constants and nothing else.
 *
 * A leaf module with no imports on purpose: `db/claimFixtures.ts` is a CLI script and must know
 * which rows are pre-auth, but pulling that fact out of `lib/auth.ts` would drag `next/headers`,
 * `next/navigation` and the request-path database seam into a plain Node process.
 *
 * Both constants disappear with the fallback when step 04 closes. They are deleted, not disabled —
 * a fallback identity that still exists will eventually be used by accident.
 */

/** Fixed so the dev golfer keeps their swings across restarts. Obviously a dev artifact on sight. */
export const DEV_USER_ID = "00000000-0000-4000-8000-0000000000de";

/**
 * The address the development identity is STORED under, which is deliberately not the one
 * `DEV_USER_EMAIL` names.
 *
 * `users.email` is UNIQUE, so a fallback identity holding a real address squats it: the day that
 * person signs in for real, `app.ensure_profile()` fails on the unique constraint and every
 * request 500s — at exactly the moment sign-in is supposed to start working. A `.invalid` address
 * (RFC 2606, reserved and permanently unresolvable) makes the collision impossible while keeping
 * the row obviously synthetic on sight.
 *
 * `DEV_USER_EMAIL` still says which human the fallback stands in for, and is logged on every
 * resolution for that reason. It just never reaches the database.
 */
export const DEV_USER_STORED_EMAIL = "dev@swingsage.invalid";
