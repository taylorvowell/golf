# 06 - Swing, Session, and Equipment Model

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2–3 days

## Overview

Rebuild the Swing record around what §7 actually describes, and add the session (§8) and
equipment (§6) models around it.

The single blocking defect today: **a swing is one video**. §7.1 says a Swing may hold a
down-the-line view, a face-on view, or both, and §12 makes dual-angle capture a headline
feature. That is a schema change, not a UI change, and everything downstream — the player's
view switcher, synchronized dual playback, dual-angle upload, multi-phone association — is
blocked until a Swing can hold more than one video.

## Dependencies

- ~~Step 05 complete (profiles exist; equipment and swings attach to a real golfer).~~
  **Amended 2026-08-11 (D27): this was overstated.** This step needs *a user id to attach rows
  to*, which step 03 already provides — it does not need roles, onboarding or profile UI. Reading
  it as a hard dependency put the product's core domain model behind two steps of identity
  plumbing for no technical reason.

## Architectural Context

- `PROJECT_MAIN.md` §6 (equipment), §7 (swing record), §8 (practice sessions),
  §7.3 (organization: favourite, tags, coach-reviewed status).
- `docs/CURRENT-STATE.md` §7 — `swings.id` is currently the `out/<id>/` folder name, which
  couples the database key to local disk layout. Step 07 moves media to object storage, so the
  identifier scheme must stop depending on a directory name.
- A `sessions` table already exists with date/location/notes and is entirely unused.
- The `analysis.json` contract is **not** changed by this step. The artifact stays per-video;
  a Swing gains the ability to reference more than one of them.

## Files & Areas Touched

- `apps/web/src/db/schema.ts`, `apps/web/drizzle/`
- `apps/web/src/lib/swings.ts`
- `apps/web/src/db/backfill.ts`

## Steps

1. Restructure Swing as a record that owns one or more **views**, each with its own video,
   view type (DTL/face-on), and its own analysis artifact. A golfer is never required to
   provide both (§7.1).
2. Give Swing a stable identifier independent of any storage path, and migrate existing rows.
3. Add the swing fields §7.2 names that do not exist: notes, session association, analysis
   version, coach-reviewed status.
4. Add §7.3's organization affordances: favourite/bookmark, tags, and the status fields the
   log will filter on.
5. Make practice sessions real (§8): swings group into a session; sessions carry notes, clubs
   used, goals, and a selected representative swing.
6. Model equipment (§6): a club inventory with category/type/number/loft/brand/model/shaft/
   flex/length/lie, ball information, and the link from a swing to the club used. Preserve the
   existing free-text club value through the migration rather than dropping it.
7. Keep `--club-type driver|irons` working — the analyzer's club-aware scoring bands read it,
   and equipment should now be able to supply it automatically.
8. Answer the §43 swing-data questions this forces: are sessions auto- or manually created, can
   a swing move between sessions, are raw recordings retained alongside trimmed clips. Record
   in `docs/decisions/`.

## Quality Standards

- A Swing with two views is representable and queryable, and a Swing with one view is not
  penalized by the model.
- No column stores a filesystem path as an identity.
- Existing analysed fixtures survive the migration with their scores intact.
- `analysis.json` is untouched — `git diff` shows no change to the analyzer's output contract.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter web db:migrate
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
```

Plus: a migration test asserting every pre-existing swing still resolves to its analysis and
score after the rebuild.

## Definition of Done

- [ ] A Swing can hold DTL, face-on, or both, each with its own artifact.
- [ ] Swing identity no longer depends on a directory name; existing rows migrated.
- [ ] Sessions, equipment, tags, favourites and coach-reviewed status exist in the schema.
- [ ] All seven existing analysed fixtures still resolve with correct scores.
- [ ] `analysis.json`'s contract is unchanged.
- [ ] The §43 swing-data questions are answered in `docs/decisions/`.

## Notes

Resist building UI for any of this here — the log, filters and session views belong to
`history-and-trends`. This step earns its keep by unblocking dual-view, which four later tracks
depend on.
