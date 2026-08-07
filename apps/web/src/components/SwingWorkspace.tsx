"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Analysis } from "@/lib/swings";
import type { CheckResult, Scorecard } from "@/lib/scoreDisplay";
import { DEFAULT_TOGGLES, type Toggles } from "@/lib/overlays";
import { buildSwingSync } from "@/lib/swingSync";
import { playbackWindow } from "@/lib/playbackWindow";
import { usePlayer } from "@/lib/usePlayer";
import DebugMenu from "./DebugMenu";
import ReanalyzeProgress from "./ReanalyzeProgress";
import { useReanalyze } from "@/lib/useReanalyze";
import { useClubTest } from "@/lib/useClubTest";
import type { TrackingTestId, VariantId } from "@/lib/clubTests";
import { DEFAULT_SMOOTHING, type SmoothingKey } from "@/lib/traceSmoothing";
import { clubVariantOptions, defaultClubVar } from "@/lib/clubVariants";
import { useRawModels } from "@/lib/useRawModels";
import SwingStage from "./SwingStage";
import SwingTransport from "./SwingTransport";
import ComparisonPane from "./ComparisonPane";
import { useSwingStages } from "@/lib/useSwingStages";
import { phaseFrames, phaseNameAt } from "@/lib/swingPhases";
import { CompareButton, SourcePicker } from "./ComparisonBar";
import { PRO_SWING_ID, proSwing } from "@/lib/proSwings";
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
  id, analysis, scorecard, prevId, nextId, missing, currentSchema,
}: {
  id: string;
  analysis: Analysis;
  /** null when this swing predates Stage 8 or was analysed with `--no-scoring`. */
  scorecard: Scorecard | null;
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

  // The Overview checkpoint-detail check a golfer is hovering/has clicked, if any — Overview
  // owns pausing and seeking the player (it already holds `player`), this only owns what the
  // canvas draws. Overrides (not merges with) whatever Advanced's own angle toggles selected,
  // so inspecting one check is always a focused, single-angle view rather than adding clutter
  // on top of an unrelated Advanced-tab selection.
  const [inspecting, setInspecting] = useState<CheckResult | null>(null);
  const overlayAngles = inspecting ? [inspecting.field] : angles;
  const targetOverlay = inspecting?.kind === "band" && inspecting.band
    ? { field: inspecting.field, band: inspecting.band, absValue: inspecting.abs_value }
    : null;

  // Overlay toggles live here, not in SwingStage, so the comparison video renders the same
  // overlays as the main one from a single set of controls (see SwingStage's `toggles` prop).
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);

  /**
   * Hand-corrected phase boundaries, and the boundaries themselves once the corrections are
   * folded into the analyzer's.
   *
   * Owned here rather than in SwingStage because three separate things downstream have to agree
   * about where the swing changes phase — the scrub strip's segments, the word burned into the
   * picture, and the spans the club trace is coloured by. Each used to derive its own from
   * `analysis.events`, which is exactly why pinning a keyframe appeared to do nothing: it was
   * saved, and then nothing read it.
   */
  const stages = useSwingStages(id);
  const phases = useMemo(() => phaseFrames(analysis, player.win, stages.byStage),
                         [analysis, player.win, stages.byStage]);

  // Head-marker editing is owned by SwingStage (the markers belong to one swing's picture), but
  // the layout around it is this component's — hence the report up rather than lifting the whole
  // hook, which would have to be duplicated per pane since each stage edits its own swing.
  const [editingHeads, setEditingHeads] = useState(false);

  // ---------------------------------------------------------------- comparison
  const [compareOn, setCompareOn] = useState(false);
  const [compareId, setCompareId] = useState<string>(PRO_SWING_ID);
  /**
   * The fetched reference, tagged with the id it was fetched for.
   *
   * Kept as one id-stamped record rather than separate `analysis`/`error` state reset at the
   * top of the effect: resetting synchronously inside an effect causes a cascading render (and
   * React's lint rules reject it outright). Tagging instead means a result for a *previous*
   * selection is simply ignored below rather than briefly rendered.
   */
  const [refData, setRefData] = useState<
    { id: string; analysis: Analysis | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!compareOn) return;
    let cancelled = false;
    fetch(`/api/swings/${compareId}/analysis`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Analysis) => {
        if (!cancelled) setRefData({ id: compareId, analysis: d, error: null });
      })
      .catch(() => {
        if (cancelled) return;
        const pro = proSwing(compareId);
        setRefData({
          id: compareId, analysis: null,
          error: pro
            ? `The ${pro.label} reference hasn't been analysed on this machine yet — run `
              + `burnin.py over ${pro.source}, then \`pnpm db:backfill\`.`
            : `Couldn't load ${compareId}.`,
        });
      });
    return () => { cancelled = true; };
  }, [compareOn, compareId]);

  const refCurrent = refData?.id === compareId ? refData : null;
  const refAnalysis = refCurrent?.analysis ?? null;
  const refError = refCurrent?.error ?? null;

  /**
   * Frame mapping between this swing and the reference, anchored on the eight events — which
   * are themselves club-and-pose defined, so this aligns the two by *club position in the
   * swing* rather than by elapsed time. See `lib/swingSync.ts`.
   */
  const sync = useMemo(() => {
    if (!refAnalysis) return null;
    return buildSwingSync(analysis, refAnalysis, player.win, playbackWindow(refAnalysis));
  }, [analysis, refAnalysis, player.win]);

  const showCompare = compareOn && !!refAnalysis;

  /**
   * What the transport calls the current position.
   *
   * This used to match the playhead against exact event/checkpoint frames, so it read "Full
   * swing" everywhere except the handful of individual frames that happened to land exactly
   * on a named one — flashing to that name for a single frame and back. Bucketing by range
   * instead makes it a stable label for wherever the playhead is. Impact gets its own area on
   * the scrub strip (see SwingStage's segments) but is deliberately not one of these five —
   * it folds into Downswing/Follow Through here rather than flashing its own name for one frame.
   */
  const moment = phaseNameAt(player.frame, phases);

  /**
   * Re-analysis, owned at page level. Started from the video's settings menu, reported by the
   * banner below — the menu closes on the click that begins it, so nothing inside it can be
   * where a 90-second run lives. One hook, so the two never disagree about the same job.
   */
  const reanalyze = useReanalyze(id);

  /**
   * Club-tracking experiment selection (12-test plan, D55). The job is owned here for the
   * same reason `reanalyze` is: the Debug Menu closes on the click that starts a tracker
   * run, so nothing inside it can be where the run lives. The selection pair drives
   * SwingStage's experiment trace; null means the legacy trace.
   */
  const clubTest = useClubTest(id);
  const [expTest, setExpTest] = useState<TrackingTestId | null>(null);
  const [expVariant, setExpVariant] = useState<VariantId>("default");
  const cachedTests = useMemo(
    () => Object.keys(analysis.club_tracking?.experiments ?? {}) as TrackingTestId[],
    [analysis]);
  const experimentSel = useMemo(
    () => (expTest ? { test: expTest, variant: expVariant } : null),
    [expTest, expVariant]);
  /** Legacy-trace smoothing, lifted so the Debug Menu drives the primary stage's
   * selection (the comparison pane keeps its own, D46). */
  const [traceSmoothing, setTraceSmoothing] =
    useState<SmoothingKey>(DEFAULT_SMOOTHING);
  /** Legacy club solution — the picker moved from the Overlay menu into Debug. Picking
   * turns the club+trace overlays on and loops the swing (comparing on a still frame
   * reads as a broken control). */
  const [clubVar, setClubVar] = useState(() => defaultClubVar(analysis));
  /** Candidate raw-detection models (scripts/rawmodels.py). Picking one turns the raw
   * overlay on — comparing model output with the overlay off would show nothing. */
  const rawModels = useRawModels(id, true);
  const [rawModelSel, setRawModelSel] = useState("builtin");
  const pickRawModel = useCallback((k: string) => {
    setRawModelSel(k);
    setToggles((cur) => ({ ...cur, rawDet: true }));
  }, [setToggles]);
  const clubOptions = useMemo(() => clubVariantOptions(analysis), [analysis]);
  const pickClubVar = useCallback((key: string) => {
    setClubVar(key);
    setToggles((cur) => ({ ...cur, club: true, trace: true }));
    const e = analysis.events;
    if (e) player.playRange(e.address.frame, e.finish.frame);
  }, [analysis, player, setToggles]);

  return (
    <main className="relative mx-auto max-w-[1800px] space-y-5 px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-7">
      <section id="summaryPanel"
        // The video column doubles in width when the comparison is showing, sliding the panels
        // column over rather than squeezing the two videos into the single-video slot.
        //
        // Editing head markers inverts the split: the panels shrink to a narrow rail and the
        // picture takes the rest. Placing a club head is a pixel-accurate pointing task, so
        // during it the video IS the screen — and the coaching panels are not what you are
        // looking at. The rail is kept rather than hidden so the layout doesn't reflow out from
        // under you when the mode ends. It takes precedence over the comparison split, which is
        // the same trade in the other direction.
        className={`grid items-start gap-5 transition-[grid-template-columns] duration-200 ${
          editingHeads
          ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
          : showCompare
          ? "xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,900px)_minmax(0,1fr)]"
          : "xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]"}`}>
        <div className="min-w-0 space-y-3">
          <ReanalyzeProgress r={reanalyze} />
          {refError && (
            <p className="rounded-xl border border-amber-400/25 bg-amber-400/[.07] px-3 py-2
                          text-[11px] leading-5 text-amber-200">
              {refError}
            </p>
          )}
          {compareOn && !refAnalysis && !refError && (
            <p className="text-[11px] text-neutral-500">Loading comparison swing…</p>
          )}

          {/* Each pane gets exactly half the column (`1fr 1fr`), so the two videos are the same
              width and fill the space the comparison widened the column to. Their aspect ratios
              are near-identical portrait phone video, so equal widths give equal heights without
              forcing either picture out of shape. One column below xl, where two videos side by
              side would make both unreadable. */}
          <div className={showCompare ? "grid grid-cols-2 gap-3" : ""}>
            <SwingStage id={id} analysis={analysis} player={player} angles={overlayAngles}
                       moment={moment} targetOverlay={targetOverlay}
                       toggles={toggles} setToggles={setToggles}
                       onEditingChange={setEditingHeads}
                       stages={stages} phases={phases}
                       reanalyze={reanalyze}
                       experiment={experimentSel}
                       smoothing={traceSmoothing} onSmoothing={setTraceSmoothing}
                       clubVar={clubVar}
                       rawOverride={rawModelSel !== "builtin"
                         ? rawModels.byModel.get(rawModelSel) ?? null : null}
                       hasRawModels={rawModels.models.length > 0}
                       topRight={<CompareButton enabled={compareOn} onToggle={setCompareOn} />} />

            {showCompare && refAnalysis && (
              <ComparisonPane
                id={compareId}
                analysis={refAnalysis}
                sync={sync}
                userFrame={player.frame}
                userPlaying={player.playing}
                userSpeed={player.speed}
                toggles={toggles}
                setToggles={setToggles}
                sourcePicker={
                  <SourcePicker sourceId={compareId} onPickSource={setCompareId} currentId={id} />
                }
              />
            )}
          </div>

          {/* ONE transport for both. The reference has no controls of its own — it is held at
              the same point in the swing as the video beside it, so a second scrubber (and the
              lock that used to sit between them) was a relationship to manage rather than a fact. */}
          <SwingTransport player={player} phases={phases} />

          {showCompare && sync && (
            <p className="text-[10px] leading-4 text-neutral-600">
              {sync.method === "landmarks"
                ? "Matched at address, top and impact, then by how far your hands travel between "
                  + "them — the reference holds at address until you start and freezes at its "
                  + "finish. Backswing and downswing track closest."
                : "Neither swing had enough tracked hand data to anchor on, so the reference is "
                  + "stretched evenly across yours and will not hold position."}
            </p>
          )}
        </div>

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
            <OverviewView analysis={analysis} scorecard={scorecard} player={player}
                         inspecting={inspecting} onInspect={setInspecting} />
          )}
          {view === "coach" && (
            <CoachView analysis={analysis} scorecard={scorecard} player={player} />
          )}
          {view === "advanced" && (
            <AdvancedView analysis={analysis} scorecard={scorecard} player={player}
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
      <DebugMenu id={id} reanalyze={reanalyze} clubTest={clubTest}
                 cached={cachedTests} sel={experimentSel}
                 onPickTest={setExpTest} onPickVariant={setExpVariant}
                 smoothing={traceSmoothing} onPickSmoothing={setTraceSmoothing}
                 clubOptions={clubOptions} clubVar={clubVar} onPickClub={pickClubVar}
                 rawModels={rawModels.models} rawModelSel={rawModelSel}
                 onPickRawModel={pickRawModel} />
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
