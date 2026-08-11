import { notFound } from "next/navigation";
import SwingWorkspace from "@/components/SwingWorkspace";
import { CURRENT_ARTIFACT_SCHEMA, missingCapabilities } from "@swingsage/schema/contract";
import { withUser } from "@/db/session";
import { getAnalysis, listSwings } from "@/lib/swings";
import { requireUserId } from "@/lib/auth";
import { isViewType, mediaAddress, resolveView } from "@/db/views";
import { getScorecard } from "@/lib/scoring";

export const dynamic = "force-dynamic";

/**
 * The player, for one swing.
 *
 * `[id]` is the SWING's id, and `?view=dtl|face_on` names which camera — the same contract the
 * artifact routes take, so the page and the fetches its client makes always agree about which
 * video is on screen. Without the parameter it resolves to the swing's primary view, which is
 * every swing today (§7.1's second camera is a schema capability as of migration 0006; the view
 * switcher that exercises it is `mobile-player`'s to build, not this step's).
 */
export default async function SwingPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const userId = await requireUserId();

  // One transaction for both database reads, under this user's identity: row-level security
  // filters `resolveView` before the ownership check below ever runs, so a stranger's swing is
  // not merely rejected here — it is not returned (D42).
  const { resolved, swings } = await withUser(userId, async (tx) => ({
    resolved: await resolveView(tx, id, view && isViewType(view) ? view : null),
    swings: await listSwings(tx, userId),
  }));
  // Ownership, not just existence — defence in depth behind the policy, and what distinguishes a
  // coach's read (allowed by RLS, not yet supported by this page) from the owner's.
  if (!resolved || resolved.userId !== userId) notFound();

  const [analysis, scorecard] = await Promise.all([
    getAnalysis(mediaAddress(resolved)), getScorecard(mediaAddress(resolved)),
  ]);
  if (!analysis) notFound();

  // The log is newest-first, so the next entry is the older swing — which is what "previous"
  // means to a golfer reviewing a session.
  const i = swings.findIndex((s) => s.id === id);
  const olderId = i >= 0 && i + 1 < swings.length ? swings[i + 1].id : null;
  const newerId = i > 0 ? swings[i - 1].id : null;

  // Resolved here rather than on the client: which rows are bundled references is a database
  // fact (`swings.reference_label`) since migration 0006, and the comparison picker is a client
  // component that cannot ask.
  const references = swings
    .filter((s) => s.referenceLabel)
    .map((s) => ({ id: s.id, label: s.referenceLabel! }));

  return (
    <SwingWorkspace
      id={id}
      analysis={analysis}
      scorecard={scorecard}
      references={references}
      prevId={olderId}
      nextId={newerId}
      missing={missingCapabilities(analysis)}
      currentSchema={CURRENT_ARTIFACT_SCHEMA}
    />
  );
}
