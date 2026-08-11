/**
 * Artifact addressing — where a swing's media lives, derived from identity.
 *
 * Until step 09 a swing's media was addressed by the analyzer's output folder name
 * (`out/<stem>/analysis.json`), which is why the analyzer could not run anywhere but the
 * developer's laptop. A key here is computed from uuids the database already owns, so the same
 * address resolves on a filesystem, in Supabase Storage, or behind a CDN later.
 *
 * Nothing in this module reads the database or the filesystem — it is pure string math, so the
 * scheme itself is unit-testable without either.
 */

/**
 * Source uploads and derived artifacts live in **separate buckets** because they have unrelated
 * lifecycles: D29 keeps the untrimmed original 30 days and then drops it, while the artifacts it
 * produced stay for as long as the swing does. One bucket would mean one retention rule for both,
 * and the only rule satisfying both is the longer one.
 */
export const SOURCE_BUCKET = "swing-source";
export const ARTIFACT_BUCKET = "swing-artifacts";

/**
 * Everything needed to address one view's media. Every field is an id the database minted, which
 * is the property that makes a key stable: renaming a file, re-analysing a swing or moving the
 * analyzer to another machine changes none of them.
 */
export interface ViewAddress {
  userId: string;
  swingId: string;
  viewId: string;
  /**
   * Which analysis run produced the artifacts. Incremented by a re-analysis, never reused.
   *
   * This is what stops a re-analysis from pulling the video out from under someone watching it:
   * the player holds `r3` URLs for its whole session while the new run writes `r4` alongside.
   * Without it the step's "does not orphan or overwrite artifacts another session is reading"
   * requirement is unmeetable — object storage has no rename-into-place.
   */
  revision: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys are built from database ids, but "the database said so" has never been a reason to skip
 * validation — the ids arrive there from an upload. A malformed segment must fail here rather
 * than downstream, where on the local driver it would be joined to a filesystem root.
 */
function segment(kind: string, value: string): string {
  if (!UUID.test(value)) throw new Error(`invalid ${kind} in media key: ${JSON.stringify(value)}`);
  return value.toLowerCase();
}

/**
 * The prefix owning everything about one camera's recording, in either bucket.
 *
 * **The user id leads deliberately.** D7 makes the database the authorization boundary, and a
 * Supabase Storage policy can only reason about path segments — `storage.foldername(name)[2]`
 * is the owner. Leading with it is what lets the bucket enforce ownership itself rather than
 * trusting every route to have checked, which is the same defence-in-depth argument that put RLS
 * under the tables in migration 0003.
 */
export function viewPrefix(a: ViewAddress): string {
  return `u/${segment("userId", a.userId)}/s/${segment("swingId", a.swingId)}/v/${segment("viewId", a.viewId)}`;
}

/** One analysis run's output. Immutable once written — a re-run writes the next revision. */
export function revisionPrefix(a: ViewAddress): string {
  if (!Number.isInteger(a.revision) || a.revision < 1) {
    throw new Error(`invalid artifact revision: ${a.revision}`);
  }
  return `${viewPrefix(a)}/r${a.revision}`;
}

/** A derived artifact, in `ARTIFACT_BUCKET`. */
export function artifactKey(a: ViewAddress, name: ArtifactName): string {
  return `${revisionPrefix(a)}/${name}`;
}

/**
 * The uploaded original, in `SOURCE_BUCKET`. Outside the revision prefix on purpose: re-analysing
 * produces new artifacts from the *same* source, so a source that moved with the revision would
 * be copied for nothing and D29's 30-day expiry would have several objects to chase.
 */
export function sourceKey(a: ViewAddress, filename: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw new Error("invalid source filename");
  return `${viewPrefix(a)}/source/${filename}`;
}

/**
 * The artifact set one analysis run produces, exactly as `docs/CURRENT-STATE.md` §3 lists it.
 *
 * Names match what `burnin.py` writes because step 09 changes only *where* artifacts land, never
 * what the analyzer produces — the `analysis.json` contract is untouched by this step.
 */
export const ARTIFACTS = {
  "analysis.json": { contentType: "application/json", lazy: false },
  "coach_report.json": { contentType: "application/json", lazy: false },
  "source_timing.json": { contentType: "application/json", lazy: false },
  /** Large (0.3–1.1 MB) and only wanted when its overlay is on — fetched lazily by the player. */
  "silhouette.json": { contentType: "application/json", lazy: true },
  "isolation.json": { contentType: "application/json", lazy: true },
  "club_only.json": { contentType: "application/json", lazy: true },
  /** The CFR 60fps clip the player scrubs. Range requests over this are non-negotiable. */
  "normalized.mp4": { contentType: "video/mp4", lazy: false },
  "analysis.mp4": { contentType: "video/mp4", lazy: true },
  "overlay.mp4": { contentType: "video/mp4", lazy: true },
  /** Written on demand by `scripts/stampframes.py`; absent is the normal state. */
  "framestamp.mp4": { contentType: "video/mp4", lazy: true },
  "contact.jpg": { contentType: "image/jpeg", lazy: false },
} as const;

export type ArtifactName = keyof typeof ARTIFACTS;

export function isArtifactName(name: string): name is ArtifactName {
  return Object.prototype.hasOwnProperty.call(ARTIFACTS, name);
}

export function contentTypeFor(name: ArtifactName): string {
  return ARTIFACTS[name].contentType;
}

/** Every artifact name, for the publish step and the deletion sweep. */
export const ARTIFACT_NAMES = Object.keys(ARTIFACTS) as ArtifactName[];

/**
 * How long a playback URL stays valid.
 *
 * **This must outlive a viewing session, not a request.** A `<video>` element resolves the
 * redirect once and then issues every subsequent range request against the URL it resolved; if
 * that expires while the golfer is still scrubbing, seeking dies halfway through a session and
 * looks exactly like the frame-sync bug this project spends its effort avoiding. Six hours is
 * chosen to be longer than any plausible sitting, not as a security parameter — the object is
 * private and the key is unguessable.
 */
export const PLAYBACK_URL_TTL_SECONDS = 6 * 60 * 60;
