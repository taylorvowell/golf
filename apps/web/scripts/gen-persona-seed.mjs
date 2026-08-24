#!/usr/bin/env node
/**
 * Generate the persona DATA seed: a stable manifest of swings-per-persona plus the SQL that
 * inserts it into the data project.
 *
 * The manifest (`persona-manifest.json`, beside this script) mints a uuid for every session,
 * swing and view ONCE and keeps them — media addresses derive from those ids
 * (`src/lib/media/keys.ts`), so the DB seed and `publish-persona-media.ts` must agree on them
 * forever. Delete the manifest only to re-mint a whole new fleet.
 *
 * Auth ids come from `seed-persona-auth.mjs` output (paste below if accounts are ever
 * re-created). The SQL goes to stdout — run it on the data project as postgres (RLS bypass:
 * role grants and cross-user rows have no INSERT policies on purpose).
 *
 * Sources are analyzer fixtures (`services/analyzer/out/<stem>/`): every persona swing is a
 * real analysed swing — real video, real artifacts, real scores — cloned under the persona's
 * own identity. `media_key` is globally unique, so clones get `p-<persona>-<stem>` stems.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "persona-manifest.json");

/** From seed-persona-auth.mjs (2026-08-24). */
const USERS = {
  "new-user": { id: "298b3e67-f4ee-4c90-a9aa-2accaf8c86be", email: "persona-new@swingsage.dev", name: "Jordan Lee" },
  newby: { id: "c4aae657-9936-41f3-ac46-163fa11675fd", email: "persona-newby@swingsage.dev", name: "Priya Nair" },
  existing: { id: "bf6154f8-f7ba-4df4-9ad4-5b566f3b519d", email: "persona-existing@swingsage.dev", name: "Marcus Webb" },
  trial: { id: "68cf5bab-8027-4235-9936-0158dd3a7d3c", email: "persona-trial@swingsage.dev", name: "Danny Ortiz" },
  pro: { id: "469ab145-c9e0-4450-8800-3b5f708bdf12", email: "persona-pro@swingsage.dev", name: "Sophie Chen" },
  coach: { id: "ccc8a8dd-7fb9-43d1-a7e1-e9f49549310c", email: "persona-coach@swingsage.dev", name: "Dave Kim" },
  admin: { id: "22ecae6c-3ba4-46ca-83f3-0c2e004dec1a", email: "persona-admin@swingsage.dev", name: "Alex Morgan" },
};

/** Fixture facts, read once from the local dev DB (fps/frames/dims/score/band). */
const SRC = {
  "6iron-1": { fps: 60, frames: 519, w: 1080, h: 1920, score: 78, band: "Pure" },
  "6iron2": { fps: 60, frames: 552, w: 1080, h: 1920, score: 73, band: "Solid" },
  "6iron3": { fps: 60, frames: 519, w: 1080, h: 1920, score: 74, band: "Solid" },
  "7wood-1": { fps: 60, frames: 487, w: 1080, h: 1920, score: 43, band: "Building" },
  "7wood-2": { fps: 60, frames: 453, w: 1080, h: 1920, score: 73, band: "Solid" },
  swing1: { fps: 60, frames: 396, w: 1080, h: 1920, score: 70, band: "Solid" },
  swing2: { fps: 60, frames: 341, w: 1080, h: 2078, score: 58, band: "Building" },
  perfect: { fps: 60, frames: 829, w: 1080, h: 1946, score: 80, band: "Pure" },
  pro_3: { fps: 60, frames: 1889, w: 1080, h: 1722, score: 77, band: "Pure" },
};

/** Sessions + swings per persona. Times are deliberate history — a demo log needs a past. */
const PLAN = {
  existing: {
    sessions: [
      { key: "A", date: "2026-08-14", start: "2026-08-14T15:05:00Z", stems: ["6iron-1", "6iron2", "6iron3", "7wood-1"] },
      { key: "B", date: "2026-08-21", start: "2026-08-21T22:12:00Z", stems: ["7wood-2", "swing1", "swing2"] },
    ],
    reference: { stem: "perfect", at: "2026-08-10T12:00:00Z" },
  },
  trial: {
    sessions: [
      { key: "A", date: "2026-08-19", start: "2026-08-19T14:20:00Z", stems: ["6iron-1", "7wood-1", "swing2"] },
    ],
    reference: { stem: "perfect", at: "2026-08-18T12:00:00Z" },
  },
  pro: {
    sessions: [
      { key: "A", date: "2026-08-17", start: "2026-08-17T17:30:00Z", stems: ["6iron2", "6iron3"] },
      { key: "B", date: "2026-08-23", start: "2026-08-23T23:00:00Z", stems: ["pro_3", "7wood-2"] },
    ],
    reference: { stem: "perfect", at: "2026-08-15T12:00:00Z" },
  },
  // The instructor plays too — his own swings are what his students' surfaces compare against.
  coach: {
    sessions: [
      { key: "A", date: "2026-08-20", start: "2026-08-20T16:40:00Z", stems: ["pro_3", "6iron-1", "7wood-2"] },
    ],
    reference: { stem: "perfect", at: "2026-08-16T12:00:00Z" },
  },
};

/** Minutes between swings within a session — a believable range cadence. */
const GAP_MIN = 6;

function buildPersona(persona, plan) {
  const sessions = plan.sessions.map((s) => ({
    id: randomUUID(),
    date: s.date,
    start: s.start,
    swings: s.stems.map((stem, i) => ({
      swingId: randomUUID(),
      viewId: randomUUID(),
      src: stem,
      mediaKey: `p-${persona}-${stem}`,
      createdAt: new Date(Date.parse(s.start) + i * GAP_MIN * 60_000).toISOString(),
    })),
  }));
  const reference = {
    swingId: randomUUID(),
    viewId: randomUUID(),
    src: plan.reference.stem,
    mediaKey: `p-${persona}-ref-${plan.reference.stem}`,
    createdAt: plan.reference.at,
  };
  return { sessions, reference };
}

// Existing personas keep their minted uuids (media addresses derive from them — see header);
// only personas newly added to PLAN get minted and appended.
const manifest = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  : { users: USERS, personas: {} };
manifest.users = USERS;
for (const [persona, plan] of Object.entries(PLAN)) {
  if (!manifest.personas[persona]) manifest.personas[persona] = buildPersona(persona, plan);
}
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------------- SQL out
const lines = [];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

lines.push("begin;");

// Users, roles, profiles. ensure_profile() would default display_name to the email localpart,
// so the row is inserted here first with the real name; on conflict the name is corrected.
for (const [persona, u] of Object.entries(manifest.users)) {
  lines.push(
    `insert into public.users (id, email, display_name) values (${q(u.id)}, ${q(u.email)}, ${q(u.name)})` +
      ` on conflict (id) do update set display_name = excluded.display_name;`,
  );
  lines.push(
    `insert into public.user_roles (user_id, role) values (${q(u.id)}, 'golfer') on conflict do nothing;`,
  );
  if (persona === "coach")
    lines.push(`insert into public.user_roles (user_id, role) values (${q(u.id)}, 'coach') on conflict do nothing;`);
  if (persona === "admin")
    lines.push(`insert into public.user_roles (user_id, role) values (${q(u.id)}, 'admin') on conflict do nothing;`);
  // Everyone except the brand-new user has finished onboarding.
  if (persona !== "new-user") {
    lines.push(
      `insert into public.golfer_profiles (user_id, handedness, handicap_range, onboarding_completed_at)` +
        ` values (${q(u.id)}, 'right', ${persona === "pro" ? "'6_10'" : "'11_15'"}, now() - interval '20 days')` +
        ` on conflict (user_id) do nothing;`,
    );
  }
}

// The newby has been here before: the two intro spotlights are already waved away.
for (const key of ["spotlight.deep-intro.v1", "spotlight.stance-intro.v1"]) {
  lines.push(
    `insert into public.user_dismissals (user_id, key) values (${q(manifest.users.newby.id)}, ${q(key)}) on conflict do nothing;`,
  );
}

// The coach coaches Marcus — approved, so RLS opens Marcus's swings to Dave.
lines.push(
  `insert into public.coach_links (golfer_id, coach_id, status) values (${q(manifest.users.existing.id)}, ${q(manifest.users.coach.id)}, 'approved') on conflict (golfer_id, coach_id) do update set status = 'approved';`,
);

// Sessions, swings, views.
for (const [persona, data] of Object.entries(manifest.personas)) {
  const uid = manifest.users[persona].id;
  for (const session of data.sessions) {
    lines.push(
      `insert into public.sessions (id, user_id, date, session_type, created_at) values (${q(session.id)}, ${q(uid)}, ${q(session.date)}, 'swing_analysis', ${q(session.start)}) on conflict (id) do nothing;`,
    );
    for (const swing of session.swings) {
      const src = SRC[swing.src];
      const analyzed = new Date(Date.parse(swing.createdAt) + 3 * 60_000).toISOString();
      lines.push(
        `insert into public.swings (id, user_id, session_id, handedness, overall_score, band, scoring_model_version, created_at, analyzed_at) values (${q(swing.swingId)}, ${q(uid)}, ${q(session.id)}, 'right', ${src.score}, ${q(src.band)}, 'v2', ${q(swing.createdAt)}, ${q(analyzed)}) on conflict (id) do nothing;`,
      );
      lines.push(
        `insert into public.swing_views (id, swing_id, view, media_key, fps, frame_count, width, height, status, overall_score, band, scoring_model_version, is_primary, artifact_revision, created_at, analyzed_at) values (${q(swing.viewId)}, ${q(swing.swingId)}, 'dtl', ${q(swing.mediaKey)}, ${src.fps}, ${src.frames}, ${src.w}, ${src.h}, 'ready', ${src.score}, ${q(src.band)}, 'v2', true, 1, ${q(swing.createdAt)}, ${q(analyzed)}) on conflict (id) do nothing;`,
      );
    }
  }
  const ref = data.reference;
  const src = SRC[ref.src];
  const analyzed = new Date(Date.parse(ref.createdAt) + 3 * 60_000).toISOString();
  lines.push(
    `insert into public.swings (id, user_id, handedness, reference_label, overall_score, band, scoring_model_version, created_at, analyzed_at) values (${q(ref.swingId)}, ${q(uid)}, 'right', 'Pro Swing', ${src.score}, ${q(src.band)}, 'v2', ${q(ref.createdAt)}, ${q(analyzed)}) on conflict (id) do nothing;`,
  );
  lines.push(
    `insert into public.swing_views (id, swing_id, view, media_key, fps, frame_count, width, height, status, overall_score, band, scoring_model_version, is_primary, artifact_revision, created_at, analyzed_at) values (${q(ref.viewId)}, ${q(ref.swingId)}, 'dtl', ${q(ref.mediaKey)}, ${src.fps}, ${src.frames}, ${src.w}, ${src.h}, 'ready', ${src.score}, ${q(src.band)}, 'v2', true, 1, ${q(ref.createdAt)}, ${q(analyzed)}) on conflict (id) do nothing;`,
  );
}

lines.push("commit;");
writeFileSync(join(HERE, "persona-seed.sql"), lines.join("\n") + "\n");
console.log(`wrote persona-manifest.json and persona-seed.sql (${lines.length} statements)`);
