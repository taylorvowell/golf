import type {
  Analysis,
  CoachReport,
  Silhouette,
  SwingSummary,
  SwingViewSummary,
} from "@swingsage/schema/contract";

import type { DbTx } from "@/db/session";
import { ARTIFACT_BUCKET, artifactKey, type ViewAddress } from "@/lib/media/keys";
import { getJson, getMediaStore } from "@/lib/media/store";

/**
 * The web app never runs CV — it reads what the Python analyzer wrote.
 *
 * Since step 09 it reads those artifacts through `lib/media`, addressed by identity rather than
 * by the analyzer's folder name. No route touches the filesystem for media any more; the local
 * driver still puts bytes on disk, but that is a driver's business and not an assumption
 * anything above it may make.
 *
 * Since step 07 every SHAPE here comes from `@swingsage/schema`, generated from the JSON Schema
 * the analyzer validates against before it writes. There is no hand-written description of the
 * contract on this side any more — there were two clients about to describe the same objects by
 * hand, and drift would not have been a risk so much as a certainty.
 */

/**
 * One artifact belonging to one VIEW — not to a swing id, which since migration 0006 addresses a
 * shot that may hold two videos and therefore two of everything below.
 */
async function readArtifact<T>(address: ViewAddress, name: Parameters<typeof artifactKey>[1]) {
  const store = await getMediaStore();
  return getJson<T>(store, ARTIFACT_BUCKET, artifactKey(address, name));
}

/**
 * Roll a swing's per-view statuses up into one word for the log card.
 *
 * Deliberately pessimistic: a swing is only `ready` when every camera on it is, because a card
 * that says "ready" while one of two views is still analysing sends the golfer to a player that
 * can only show them half the swing. `failed` wins over "still working" for the same reason —
 * the actionable state is the one worth surfacing.
 */
function rollUpStatus(views: { status: string }[]): string {
  if (!views.length) return "uploaded";
  if (views.some((v) => v.status === "failed")) return "failed";
  if (views.every((v) => v.status === "ready")) return "ready";
  return views.find((v) => v.status === "analyzing" || v.status === "queued")?.status ?? "uploaded";
}

/**
 * The swing log, scoped to one user. Identity, ownership and sort order come from Postgres, not
 * from listing `MEDIA_ROOT` and hoping every folder has a readable `analysis.json`.
 *
 * One query with a left join rather than an inner join on the primary view: a swing whose views
 * exist but whose `is_primary` flag is somehow unset must still appear (falling back to its first
 * view) instead of silently vanishing from the golfer's own log.
 */
export async function listSwings(tx: DbTx, userId: string): Promise<SwingSummary[]> {
  // Schema and operators imported lazily so this module (used by API routes that don't touch the
  // DB, like the video and thumb streamers) stays cheap to load. The connection itself is no
  // longer part of that concern: it belongs to `db/session.ts` and arrives as `tx`.
  const { swings, swingViews } = await import("../db/schema");
  const { eq, desc, asc } = await import("drizzle-orm");

  const rows = await tx.select({ swing: swings, view: swingViews }).from(swings)
    .leftJoin(swingViews, eq(swingViews.swingId, swings.id))
    .where(eq(swings.userId, userId))
    .orderBy(desc(swings.createdAt), asc(swingViews.createdAt));

  // Grouped in JS rather than with an aggregate: the row count is one per camera, the log is one
  // card per swing, and preserving the join's order keeps "first view" deterministic.
  const grouped = new Map<string, { swing: typeof rows[number]["swing"]; views: SwingViewSummary[] }>();
  for (const row of rows) {
    let entry = grouped.get(row.swing.id);
    if (!entry) {
      entry = { swing: row.swing, views: [] };
      grouped.set(row.swing.id, entry);
    }
    if (row.view) {
      entry.views.push({
        id: row.view.id,
        view: row.view.view,
        mediaKey: row.view.mediaKey,
        revision: row.view.artifactRevision,
        fps: row.view.fps ?? 0,
        frameCount: row.view.frameCount ?? 0,
        width: row.view.width,
        height: row.view.height,
        status: row.view.status,
        overallScore: row.view.overallScore,
        band: row.view.band,
      });
    }
  }

  const out: SwingSummary[] = [];
  for (const { swing, views } of grouped.values()) {
    const primaryRow = rows.find((r) => r.swing.id === swing.id && r.view?.isPrimary)?.view;
    const primary = views.find((v) => v.id === primaryRow?.id) ?? views[0] ?? null;

    let model: string | null = null;
    let tempoRatio: number | null = null;
    let traceEnabled = false;
    let poseCoverage = 0;
    if (primary) {
      const a = await getAnalysis({
        userId: swing.userId,
        swingId: swing.id,
        viewId: primary.id,
        revision: primary.revision,
      }).catch(() => null);
      // Null when the artifact isn't readable (mid-analysis, or never published) — still show the
      // row with its DB-known fields rather than dropping it from the golfer's own log.
      if (a) {
        const joints = Object.values(a.quality?.per_joint ?? {});
        model = a.pose.model;
        tempoRatio = a.tempo?.ratio ?? null;
        traceEnabled = !!a.club?.trace_enabled;
        poseCoverage = joints.length
          ? joints.reduce((s, j) => s + j.coverage, 0) / joints.length
          : 0;
      }
    }

    out.push({
      id: swing.id,
      label: swing.referenceLabel ?? primary?.mediaKey ?? swing.id,
      referenceLabel: swing.referenceLabel,
      views,
      primaryViewId: primary?.id ?? null,
      frameCount: primary?.frameCount ?? 0,
      fps: primary?.fps ?? 0,
      view: primary?.view ?? "dtl",
      overallScore: swing.overallScore,
      band: swing.band,
      scoringModelVersion: swing.scoringModelVersion,
      status: rollUpStatus(views),
      createdAt: swing.createdAt.getTime(),
      model,
      tempoRatio,
      traceEnabled,
      poseCoverage,
    });
  }
  return out;
}

/** By address — the caller resolves a swing id to a view first (`db/views.ts`). */
export async function getAnalysis(address: ViewAddress): Promise<Analysis | null> {
  return readArtifact<Analysis>(address, "analysis.json");
}

/**
 * The scorecard — Stage 8's whole output, with no AI in it.
 *
 * Separate from `analysis.json` deliberately: scoring is a pure function of the artifact plus a
 * versioned config, so `rescore.py` rewrites this without touching the geometry. Null when the
 * swing was analysed with `--no-scoring`, which is a real state and not an error — a client shows
 * the swing and says it has not been scored rather than inventing a number for it.
 */
export async function getCoachReport(address: ViewAddress): Promise<CoachReport | null> {
  return readArtifact<CoachReport>(address, "coach_report.json");
}

/**
 * The per-frame outline, if this swing has one. Absent for every swing analysed before Stage
 * 2b existed and for any run passed `--no-silhouette`, so the caller must handle null — the
 * overlay group hides itself rather than offering a toggle that draws nothing.
 *
 * Deliberately NOT folded into `getAnalysis`: this is up to a megabyte, the swing page loads
 * the analysis on every visit, and most visits never turn the silhouette on.
 */
export async function getSilhouette(address: ViewAddress): Promise<Silhouette | null> {
  return readArtifact<Silhouette>(address, "silhouette.json");
}

/** Golfer+club rings (scripts/isolate.py) — silhouette.json's shape, so one reader. */
export async function getIsolation(address: ViewAddress): Promise<Silhouette | null> {
  return readArtifact<Silhouette>(address, "isolation.json");
}

/** Club-only rings — the subtractive view (attached motion minus the body). */
export async function getClubOnly(address: ViewAddress): Promise<Silhouette | null> {
  return readArtifact<Silhouette>(address, "club_only.json");
}

/**
 * Whether the silhouette artifact exists, without reading a megabyte to find out.
 *
 * The swing page needs this at render time to decide whether the overlay group is offered at
 * all; the data itself is fetched by the browser only once that toggle goes on. Over the network
 * driver this is a metadata listing rather than a download, which is the reason it stayed a
 * separate call instead of becoming `!!(await getSilhouette(...))`.
 */
export async function hasSilhouette(address: ViewAddress): Promise<boolean> {
  const store = await getMediaStore();
  return store.exists(ARTIFACT_BUCKET, artifactKey(address, "silhouette.json"));
}
