"use client";

import type { Scorecard } from "@/lib/scoreDisplay";
import { CATEGORY_LABELS, CATEGORY_ORDER, describeCheck } from "@/lib/scoreDisplay";
import { Chip, DataRow, KioskPanel, MicroHead, QualityBar } from "./ui/kiosk";

/**
 * Every check the real scoring engine (`swingsage/scoring.py`, the scoring spec's Part C1) evaluated for
 * this swing — the Advanced tab's measurements-only promise extended to scores: every number
 * here is read straight from `coach_report.json`, same as the angle table reads straight from
 * `analysis.json`. Composed entirely from existing `kiosk.tsx` primitives (`KioskPanel`,
 * `DataRow`, `QualityBar`, `Chip`, `MicroHead`) — no new low-level UI needed.
 */
export default function CriteriaBreakdown({ scorecard }: { scorecard: Scorecard | null }) {
  if (!scorecard) {
    return (
      <KioskPanel className="p-5">
        <MicroHead tone="acid">Scoring</MicroHead>
        <p className="mt-2 text-[11px] leading-5 text-neutral-500">
          This swing has no <code className="text-neutral-400">coach_report.json</code> —
          analysed before Stage 8 existed, or re-run with <code className="text-neutral-400">
          --no-scoring</code>. Re-analyze to score it.
        </p>
      </KioskPanel>
    );
  }

  return (
    <KioskPanel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MicroHead tone="acid">Scoring</MicroHead>
        <Chip tone="violet">
          {scorecard.scoring_model_version}
          {scorecard.club_type ? ` · ${scorecard.club_type}` : " · club type unknown"}
        </Chip>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-neutral-500">
        Every check below is a row from <code className="text-neutral-400">scoring_config/criteria.md</code>,
        scored against <code className="text-neutral-400">scoring_config/{scorecard.scoring_model_version}.json</code> —
        see <code className="text-neutral-400">services/analyzer/scoring_config/COVERAGE.md</code> for
        exactly which criteria rows are wired versus deferred. A check reads
        &ldquo;not measured&rdquo; when its input was untracked, its checkpoint&apos;s own
        detection confidence was too low, or it needs a club type / camera view this swing
        doesn&apos;t have. It reads &ldquo;not scored yet&rdquo; when the measurement behind it
        isn&apos;t trustworthy enough to score on any swing — our gap, not this clip&apos;s.
        Neither is ever a fabricated score.
      </p>
      {scorecard.coverage && (
        <p className="mt-2 text-[11px] leading-5 text-neutral-500 tabular-nums">
          This swing: <span className="text-neutral-300">{scorecard.coverage.scored}</span> of{" "}
          {scorecard.coverage.total_checks} checks scored ·{" "}
          {scorecard.coverage.skipped_this_swing} skipped for this clip ·{" "}
          {scorecard.coverage.deferred_in_config} not scored yet in{" "}
          {scorecard.scoring_model_version}.
        </p>
      )}

      <div className="mt-4 space-y-5">
        {CATEGORY_ORDER.map((cat) => {
          const c = scorecard.categories[cat];
          if (!c) return null;
          return (
            <div key={cat}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{CATEGORY_LABELS[cat] ?? cat}</p>
                <span className="text-[10px] tabular-nums text-neutral-500">
                  {c.n_measurable}/{c.n_total} measured
                  {c.n_deferred ? ` · ${c.n_deferred} not scored yet` : ""}
                </span>
              </div>
              <QualityBar label={c.score !== null ? `${c.score.toFixed(1)} / 100` : "not measurable"}
                          pct={c.score ?? 0} />
              <div className="mt-1">
                {c.checks.map((check) => (
                  <DataRow key={check.id}
                    label={`${check.id} · ${check.label}`}
                    value={check.score !== null
                      ? `${check.score.toFixed(1)} — ${describeCheck(check)}`
                      : `${check.deferred ? "not scored yet" : "not measured"} — ${check.skip_reason}`}
                    tone={check.score === null ? "warn" : undefined}
                    title={check.fix}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </KioskPanel>
  );
}
