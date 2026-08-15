import type { CoachReport, SwingSummary } from "@swingsage/schema/contract";

/**
 * Pure mapping: the coach report (Stage 8's artifact, no AI in it) + the swing summary →
 * exactly what the Ideal Swing report sheet renders. Every value traces to the report;
 * anything the report could not measure renders as an ABSTENTION, never a fabricated number
 * — confidence honesty is the product position, not a nicety.
 */

export interface PhaseReading {
  /** The checkpoint's P-code, e.g. "P1". */
  p: string;
  label: string;
  score: number;
}

export interface ReportViewModel {
  header: {
    title: string;
    /** "irons · dtl · 60 fps" — only the parts actually known. */
    meta: string;
  };
  /** The confidence line: band + how much of the config actually scored. */
  indicator: {
    band: string | null;
    coverage: string;
  };
  focus: {
    eyebrow: string;
    issue: string;
    description: string;
    /** The one directional cue — the priority's cue or the primary check's advice. */
    coachAdvice: string | null;
    /** Checkpoint tag labels (moment + phase), only the ones known. */
    tags: string[];
  } | null;
  board: {
    overall: number | null;
    headline: string;
    copy: string;
    strongest: PhaseReading | null;
    weakest: PhaseReading | null;
    /** Tempo ratio with its honest verdict, when the artifact measured one. */
    tempo: { ratio: string; verdict: string } | null;
  };
  split: {
    positive: { title: string; body: string } | null;
    opportunity: { title: string; body: string } | null;
  };
  /** "{Category} {score}" chips — the 3–4 headline categories, never the full dump. */
  chips: string[];
}

/** Ratio → honest verdict. Tour pace sits near 3:1 (the player's own copy). */
export function tempoVerdict(ratio: number): string {
  if (ratio >= 2.6 && ratio <= 3.4) return "in range";
  return ratio < 2.6 ? "quick" : "slow";
}

function phases(report: CoachReport): PhaseReading[] {
  return Object.values(report.checkpoints)
    .filter((c) => c.n_measurable > 0)
    .map((c) => ({ p: c.p, label: c.label, score: Math.round(c.score) }));
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "setup_posture" → "Setup posture" — the moment sometimes carries a raw id. */
function humanize(s: string): string {
  return titleCase(s.replace(/_/g, " ").toLowerCase());
}

export function buildReportViewModel(
  report: CoachReport,
  swing: Pick<SwingSummary, "label" | "view" | "fps" | "tempoRatio">,
): ReportViewModel {
  const all = phases(report);
  const strongest = all.length
    ? all.reduce((a, b) => (b.score > a.score ? b : a))
    : null;
  const weakest = all.length
    ? all.reduce((a, b) => (b.score < a.score ? b : a))
    : null;

  const overall = report.overall !== null ? Math.round(report.overall) : null;

  // .report-meta — club · view · fps, only what is actually declared.
  const metaParts: string[] = [];
  if (report.club_type) metaParts.push(report.club_type);
  metaParts.push(swing.view === "face_on" ? "face-on" : "down the line");
  if (swing.fps) metaParts.push(`${Math.round(swing.fps)} fps`);

  // The focus block leans on the primary fix; a report without one (nothing measurable)
  // drops the block entirely rather than inventing an opportunity.
  const hasPrimary = report.primary && report.primary.title;
  const primaryCheck = hasPrimary
    ? Object.values(report.categories)
        .flatMap((c) => c.checks)
        .find((c) => c.id === report.primary.id)
    : undefined;

  const rawAdvice =
    primaryCheck?.advice ?? (report.priorities.length ? report.priorities[0].cue : null);
  const focus = hasPrimary
    ? {
        eyebrow: "Biggest opportunity",
        issue: report.primary.title,
        description: report.primary.copy,
        // A cue that restates the headline is noise, not coaching — drop the duplicate.
        coachAdvice:
          rawAdvice !== null &&
          rawAdvice !== report.primary.title &&
          rawAdvice !== report.primary.copy
            ? rawAdvice
            : null,
        tags: [report.primary.moment]
          .filter((v): v is string => !!v)
          .map(humanize),
      }
    : null;

  // .report-board h4 — deterministic from the phase extremes; degrade gracefully.
  let headline: string;
  if (strongest && weakest && strongest.p !== weakest.p) {
    headline = `Strong ${strongest.label.toLowerCase()}. ${titleCase(
      weakest.label.toLowerCase(),
    )} still leaks points.`;
  } else if (strongest) {
    headline = `${titleCase(strongest.label.toLowerCase())} carries this swing.`;
  } else {
    headline = "Not enough measured to profile this swing.";
  }

  const copy =
    overall === null
      ? "The clip did not support scoring — no number beats a wrong one."
      : overall >= 80
        ? "This swing is close enough that the details matter more than the broad motion."
        : overall >= 60
          ? "The broad motion is there — the phases below say where the points are."
          : "Foundational positions first: the phases below say where to start.";

  const positive = report.findings.find((f) => f.tone === "positive") ?? null;
  const negative = report.findings.find((f) => f.tone === "negative") ?? null;

  const chips = Object.values(report.categories)
    .filter((c) => c.score !== null && c.n_measurable > 0)
    .sort((a, b) => b.n_measurable - a.n_measurable)
    .slice(0, 4)
    .map((c) => `${humanize(c.category)} ${Math.round(c.score as number)}`);

  const scoredLine = `${report.coverage.scored} of ${
    report.coverage.total_checks - report.coverage.deferred_in_config
  } checks scored`;

  return {
    header: { title: swing.label, meta: metaParts.join(" · ") },
    indicator: { band: report.band, coverage: scoredLine },
    focus,
    board: {
      overall,
      headline,
      copy,
      strongest,
      weakest: strongest && weakest && strongest.p === weakest.p ? null : weakest,
      tempo:
        typeof swing.tempoRatio === "number"
          ? {
              ratio: `${swing.tempoRatio.toFixed(1)}:1`,
              verdict: tempoVerdict(swing.tempoRatio),
            }
          : null,
    },
    split: {
      // Findings carry the human sentence in `title`; `detail` is the raw category id
      // (scoring.py:305–310) — so the panel body is the title, never the id.
      positive: positive ? { title: "Primary positive", body: positive.title } : null,
      opportunity: negative
        ? { title: "Main opportunity", body: negative.title }
        : hasPrimary
          ? { title: "Main opportunity", body: report.primary.copy }
          : null,
    },
    chips,
  };
}
