"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Analysis } from "@/lib/swings";
import { EV_SHORT } from "@/lib/skeleton";
import { usePlayer } from "@/lib/usePlayer";
import DebugMenu from "./DebugMenu";
import SwingStage from "./SwingStage";
import OverviewView from "./views/OverviewView";
import CoachView from "./views/CoachView";
import AdvancedView from "./views/AdvancedView";

/** Drawing more than this at once stops teaching and starts obscuring the golfer. */
const MAX_ANGLES = 4;

type ViewKey = "overview" | "coach" | "advanced";

const TABS: { key: ViewKey; icon: string; label: string }[] = [
  { key: "overview", icon: "◎", label: "Overview" },
  { key: "coach", icon: "✦", label: "Coach" },
  { key: "advanced", icon: "▤", label: "Advanced Stats" },
];

/**
 * The swing workspace — the sample's `workspace-bar` + `#summaryPanel` split.
 *
 * The video is permanent on the left; the three folder tabs swap what sits beside it. That is
 * the reorganisation this redesign is for: the golfer's read (Overview), the coaching read
 * (Coach) and the engineering read (Advanced) are three depths of the same swing rather than
 * six equal-weight panels in a sidebar. Overlay selection moved onto the video itself, where
 * the decision is actually made — see OverlayMenu.
 *
 * State that both the stage and the panels need lives here: the playhead (via `usePlayer`)
 * and the set of angles drawn over the video. Overlay toggles stay inside the stage, because
 * nothing outside it reads them.
 */
export default function SwingWorkspace({
  id, analysis, prevId, nextId, missing, currentSchema,
}: {
  id: string;
  analysis: Analysis;
  prevId: string | null;
  nextId: string | null;
  missing: string[];
  currentSchema: number;
}) {
  const [view, setView] = useState<ViewKey>("overview");
  const [modal, setModal] = useState<"new" | "delete" | null>(null);
  const player = usePlayer(analysis);

  // Angles drawn over the video, in click order — the order decides each one's colour, so a
  // selection keeps its colour as others are added and removed around it.
  const [angles, setAngles] = useState<string[]>([]);
  const toggleAngle = useCallback((field: string) => {
    setAngles((cur) => cur.includes(field)
      ? cur.filter((f) => f !== field)
      // Oldest out rather than refusing the click: a rejected click reads as a broken control,
      // where a rotating window reads as a limit.
      : [...cur, field].slice(-MAX_ANGLES));
  }, []);

  /** What the transport calls the current position — an event name, or the whole swing. */
  const ev = analysis.events
    ? Object.entries(analysis.events).find(([, v]) => v.frame === player.frame)
    : undefined;
  const cp = analysis.checkpoints?.find((c) => c.frame === player.frame);
  const moment = ev ? (EV_SHORT[ev[0]] ?? ev[0]) : cp ? cp.label : "Full swing";

  return (
    <main className="relative mx-auto max-w-[1800px] space-y-5 px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-7">
      <section id="summaryPanel"
        className="grid items-start gap-5 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)]
                   2xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <SwingStage id={id} analysis={analysis} player={player} angles={angles} moment={moment} />

        {/* `workspace-panels` is inert above xl; below it, it is the sheet that slides up over
            the sticky video. See globals.css. */}
        <div className="workspace-panels min-w-0">
          {/* Tabs and swing actions share one row, and that row is the panel's top edge —
              `.panel-bar` overlaps the panel's border by a pixel so the active tab reads as
              part of it rather than as a chip floating above it. */}
          <div className="panel-bar">
            <nav className="folder-tabs" role="tablist" aria-label="Swing analysis views">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" onClick={() => setView(t.key)}
                  aria-selected={view === t.key}
                  className={`folder-tab ${view === t.key ? "active " : ""}flex items-center gap-3 px-7 py-3 text-left`}>
                  <span className="folder-icon grid h-10 w-10 place-items-center rounded-xl bg-white/[.04]
                                   text-lg text-neutral-500">{t.icon}</span>
                  <span className="block text-base font-bold tracking-[-.02em]">{t.label}</span>
                </button>
              ))}
            </nav>

            <div className="workspace-actions">
              {prevId ? (
                <Link href={`/swing/${prevId}`}
                  className="workspace-action border border-line bg-raised text-neutral-300
                             hover:border-violet/40 hover:bg-violet/[.07]">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m11 17-5-5 5-5" /><path d="M6 12h12a3 3 0 0 1 3 3v3" />
                  </svg><span>{nextId ? "Older swing" : "Previous swing"}</span>
                </Link>
              ) : (
                <span className="workspace-action border border-line bg-raised text-neutral-600 opacity-50">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m11 17-5-5 5-5" /><path d="M6 12h12a3 3 0 0 1 3 3v3" />
                  </svg><span>Oldest swing</span>
                </span>
              )}
              <Link href="/"
                className="workspace-action border border-line bg-raised text-neutral-300
                           hover:border-acid/35 hover:bg-acid/[.06]">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" />
                </svg><span>Swing Log</span>
              </Link>
              {/* The product's own primary action. Re-analysis moved to the debug corner — it is a
                  pipeline operation, not something a golfer reviewing a swing does. */}
              <button type="button" onClick={() => setModal("new")}
                className="workspace-action bg-[#22C55E] text-canvas shadow-[0_12px_34px_rgba(34,197,94,.22)]
                           hover:bg-[#2ade68]">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg><span>New Swing</span>
              </button>
              <button type="button" onClick={() => setModal("delete")}
                className="workspace-action workspace-action-icon border border-red-400/20 bg-red-400/[.05]
                           text-red-300 hover:bg-red-400/10"
                title="Delete swing" aria-label="Delete swing">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" />
                </svg>
              </button>
            </div>
          </div>

          {view === "overview" && (
            <OverviewView analysis={analysis} player={player} currentId={id} />
          )}
          {view === "coach" && <CoachView analysis={analysis} player={player} currentId={id} />}
          {view === "advanced" && (
            <AdvancedView analysis={analysis} player={player}
                          angles={angles} onToggleAngle={toggleAngle} />
          )}

          {/* Staleness, stated rather than implied. Controls whose data is absent used to just
          vanish, which reads as a broken UI instead of an out-of-date artifact — the artifact
          is the contract (doc 02), so editing the analyzer never updates what is already on
          disk, and that needs saying out loud.

          Only on Advanced: it is a fact about the pipeline that produced the file, not about
          the golfer's swing, and Overview is the golfer's screen. */}
          {view === "advanced" && missing.length > 0 && (
        <div className="mt-5 rounded-[24px] border border-amber-500/30 bg-amber-500/[.07] p-4">
          <p className="text-sm text-amber-200">
            This analysis was produced by an older pipeline
            {analysis.schema_version !== currentSchema && (
              <> (schema {analysis.schema_version}, current is {currentSchema})</>
            )}
            . Missing: <b>{missing.join(", ")}</b>.
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            The overlays for those are hidden rather than broken. Re-analyse to generate them —
            stored analyses never update on their own.
          </p>
        </div>
      )}
        </div>
      </section>

      {modal === "new" && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-acid">New swing</p>
              <h3 className="mt-1 text-2xl font-semibold">Ready for the next shot?</h3>
            </div>
            <button type="button" onClick={() => setModal(null)}
              className="grid h-11 w-11 place-items-center rounded-xl border border-line text-neutral-400">×</button>
          </div>
          <div className="mt-5 rounded-2xl border border-dashed border-neutral-700 bg-white/[.025] p-8 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-acid/10 text-3xl text-acid">+</span>
            <p className="mt-4 text-base font-semibold">Upload is not built yet</p>
            <p className="mt-2 text-xs leading-5 text-neutral-500">
              There is no upload flow, job queue or database (roadmap phases 0–1). A new swing is
              analysed by running the pipeline by hand; it appears in the log when it finishes.
            </p>
            <pre className="scrollbar mt-4 overflow-x-auto rounded-xl border border-line bg-black/40 p-3
                            text-left text-[11px] leading-5 text-neutral-400">
{`cd services/analyzer
.venv\\Scripts\\python.exe scripts\\burnin.py <video> \\
    --view dtl --handedness right`}
            </pre>
          </div>
        </Modal>
      )}

      {modal === "delete" && (
        <Modal onClose={() => setModal(null)} tone="danger">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-400/10 text-red-300">⌫</span>
          <h3 className="mt-4 text-center text-xl font-semibold">Delete {id}?</h3>
          <p className="mt-2 text-center text-sm leading-6 text-neutral-500">
            Deletion is not built — there is no database, so a swing is a folder under the media
            root and removing it means removing that folder. This dialog will do it once the job
            and swing tables land.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setModal(null)}
              className="rounded-2xl border border-line bg-raised px-4 py-3 text-xs font-bold text-neutral-300">
              Close
            </button>
            <button type="button" disabled
              className="rounded-2xl bg-red-400/25 px-4 py-3 text-xs font-bold text-red-200/60">
              Delete swing
            </button>
          </div>
        </Modal>
      )}

      {/* Sticky, bottom right, out of the product's own chrome. */}
      <DebugMenu id={id} />
    </main>
  );
}

function Modal({
  onClose, tone = "plain", children,
}: { onClose: () => void; tone?: "plain" | "danger"; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
         onClick={onClose} role="dialog" aria-modal="true">
      <div onClick={(e) => e.stopPropagation()}
        className={tone === "danger"
          ? "w-full max-w-md rounded-[28px] border border-red-400/20 bg-panel p-6 shadow-2xl"
          : "w-full max-w-xl rounded-[30px] border border-line bg-panel p-5 shadow-2xl sm:p-6"}>
        {children}
      </div>
    </div>
  );
}
