import Link from "next/link";
import { notFound } from "next/navigation";
import SwingPlayer from "@/components/SwingPlayer";
import { getAnalysis } from "@/lib/swings";

export const dynamic = "force-dynamic";

export default async function SwingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await getAnalysis(id);
  if (!analysis) notFound();

  const v = analysis.video;
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/" className="text-sm text-blue-400 hover:underline">← log</Link>
        <h1 className="text-lg font-semibold">{id}</h1>
        <span className="text-xs text-neutral-500">
          {v.width}×{v.height} · {v.fps.toFixed(2)}fps · {v.frame_count} frames ·{" "}
          {v.source.is_vfr ? "VFR→CFR" : "CFR"} · {v.view.toUpperCase()} · {v.handedness}-handed
        </span>
      </header>
      <SwingPlayer id={id} analysis={analysis} />
    </main>
  );
}
