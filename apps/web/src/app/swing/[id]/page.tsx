import { notFound } from "next/navigation";
import SwingWorkspace from "@/components/SwingWorkspace";
import { CURRENT_SCHEMA, getAnalysis, listSwings, missingCapabilities } from "@/lib/swings";

export const dynamic = "force-dynamic";

export default async function SwingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [analysis, swings] = await Promise.all([getAnalysis(id), listSwings()]);
  if (!analysis) notFound();

  // The log is newest-first, so the next entry is the older swing — which is what "previous"
  // means to a golfer reviewing a session.
  const i = swings.findIndex((s) => s.id === id);
  const olderId = i >= 0 && i + 1 < swings.length ? swings[i + 1].id : null;
  const newerId = i > 0 ? swings[i - 1].id : null;

  return (
    <SwingWorkspace
      id={id}
      analysis={analysis}
      prevId={olderId}
      nextId={newerId}
      missing={missingCapabilities(analysis)}
      currentSchema={CURRENT_SCHEMA}
    />
  );
}
