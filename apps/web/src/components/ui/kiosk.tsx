/**
 * The card vocabulary of the design, lifted out of `instructions/template_sample.html`.
 *
 * The sample draws every piece of content as one of about eight card shapes, each filled
 * with mock numbers. Naming them here means the shapes are the reusable thing and the data
 * is the variable — so when the scoring engine (doc 05), the coach report (doc 07) or
 * simulator ingestion (doc 06) lands, each drops into a card that already exists rather than
 * inventing its own styling.
 *
 * What each shape is for, and what will eventually fill it:
 *
 * | Component      | Sample usage            | Fed by today → by                              |
 * |----------------|-------------------------|------------------------------------------------|
 * | `KioskPanel`   | every view panel        | anything                                        |
 * | `ScoreGauge`   | the 0–100 Ideal Score   | `mockScoring` → `scoring_config.json` overall   |
 * | `IndicatorCard`| 8 scored swing moments  | `mockScoring` → per-checkpoint score            |
 * | `FindingBox`   | 6 red/green findings    | `mockScoring` → scorecard strengths/faults      |
 * | `TipCard`      | drill + session focus   | `mockScoring` → AI coach narrative              |
 * | `MetricRow`    | 54 weighted metrics     | the real angle catalogue → weighted metrics     |
 * | `StatTile`     | measurable/view-limited | real field counts                               |
 * | `DataRow`      | (new) diagnostics lines | real pose/club/face/sync numbers                |
 * | `QualityBar`   | (new) per-joint bars    | real pose coverage                              |
 * | `NotBuilt`     | (new)                   | marks a designed slot with no pipeline behind it |
 *
 * The split that matters: the first four are fed by `lib/mockScoring.ts` and every screen that
 * uses them shows a `DEMO` marker; the rest are fed straight from `analysis.json` and are real.
 * Keep it that way — a card is not the place to decide which kind of number it is holding.
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ panels */

export function KioskPanel({
  className = "", hero = false, children,
}: { className?: string; hero?: boolean; children: ReactNode }) {
  return (
    <section className={`kiosk-panel ${hero ? "hero-panel " : ""}rounded-[32px] ${className}`}>
      {children}
    </section>
  );
}

/** The 10px letterspaced label above every panel heading. */
export function Eyebrow({ tone = "acid", children }: { tone?: "acid" | "violet" | "muted"; children: ReactNode }) {
  const c = tone === "acid" ? "text-acid" : tone === "violet" ? "text-violet" : "text-neutral-600";
  return <p className={`text-[10px] font-semibold uppercase tracking-[.22em] ${c}`}>{children}</p>;
}

export function PanelTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`gradient-text mt-2 text-4xl font-semibold leading-[1.03] tracking-[-.04em] sm:text-5xl ${className}`}>
      {children}
    </h2>
  );
}

/** Small uppercase heading inside a panel — the sample's `text-[9px] tracking-[.18em]` rule. */
export function MicroHead({ tone = "muted", children }: { tone?: "acid" | "violet" | "muted"; children: ReactNode }) {
  const c = tone === "acid" ? "text-acid" : tone === "violet" ? "text-violet" : "text-neutral-600";
  return <p className={`text-[9px] font-bold uppercase tracking-[.18em] ${c}`}>{children}</p>;
}

/* -------------------------------------------------------------- placeholder */

/**
 * Marks a slot the design defines but no pipeline fills yet.
 *
 * Deliberately not a spinner or a skeleton: those say "loading", and this data is not
 * coming. It says which phase produces it, so the screen doubles as a build status.
 */
export function NotBuilt({ what, className = "" }: { what: string; className?: string }) {
  return <span className={`not-built ${className}`}>◇ {what}</span>;
}

/* -------------------------------------------------------------------- gauge */

const GAUGE_R = 140, GAUGE_CX = 180, GAUGE_CY = 180;

/**
 * The hero arc. `value` is 0–100, or null when nothing has scored the swing.
 *
 * With a value the marker rides the arc exactly as in the sample; without one the marker is
 * absent, the number reads `—`, and the caption says so. The arc itself always draws — it is
 * the scale, not the reading.
 */
export function ScoreGauge({
  value, caption, low = "Starting", mid = "Centered", high = "Pure",
}: { value: number | null; caption: string; low?: string; mid?: string; high?: string }) {
  const a = value === null ? 0 : Math.PI - (Math.max(0, Math.min(100, value)) / 100) * Math.PI;
  const cx = GAUGE_CX + Math.cos(a) * GAUGE_R;
  const cy = GAUGE_CY - Math.sin(a) * GAUGE_R;
  return (
    <svg viewBox="0 0 360 220" className="score-glow mx-auto -mb-4 mt-1 w-full max-w-[330px]">
      <defs>
        <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6d59ff" />
          <stop offset=".38" stopColor="#8b7bff" />
          <stop offset=".72" stopColor="#49a8ff" />
          <stop offset="1" stopColor="#6fe5ff" />
        </linearGradient>
      </defs>
      <path d="M40 180 A140 140 0 0 1 320 180" fill="none" stroke="rgba(255,255,255,.075)"
            strokeWidth="34" strokeLinecap="round" />
      <path d="M40 180 A140 140 0 0 1 320 180" fill="none" stroke="url(#gaugeGradient)"
            strokeWidth="22" strokeLinecap="round" opacity={value === null ? 0.42 : 1} />
      {value !== null && (
        <>
          <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="16" fill="rgba(94,208,255,.18)" />
          <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="8" fill="#080a0d" stroke="#5ed0ff" strokeWidth="5" />
        </>
      )}
      <text x="180" y="154" fill={value === null ? "#5b636e" : "#f7f8f5"} fontSize="72" fontWeight="750"
            textAnchor="middle" letterSpacing="-5">{value === null ? "—" : value}</text>
      <text x="180" y="180" fill="#7e8691" fontSize="11" fontWeight="700" textAnchor="middle"
            letterSpacing="2.4">{caption}</text>
      <text x="38" y="211" fill="#6f6fa1" fontSize="10">{low}</text>
      <text x="180" y="211" fill="#8e90c7" fontSize="10" textAnchor="middle">{mid}</text>
      <text x="322" y="211" fill="#6fe5ff" fontSize="10" textAnchor="end">{high}</text>
    </svg>
  );
}

/* --------------------------------------------------------------- indicators */

/**
 * The icon set the sample draws inside each indicator ring. Keyed by swing moment rather
 * than by checkpoint id, so P3 and P2 can legitimately share the takeaway glyph.
 */
export const INDICATOR_ICONS: Record<string, ReactNode> = {
  overall: (<><path d="M4 17a8 8 0 0 1 16 0" /><path d="m12 13 4-4" /><circle cx="12" cy="17" r="1" /><path d="M6 20h12" /></>),
  setup: (<path d="M4 18h16M7 18V9m10 9V9M7 9l5-4 5 4" />),
  takeaway: (<><path d="M4 17c4-8 9-11 16-10" /><path d="m16 4 4 3-3 4" /></>),
  top: (<><path d="M5 17 12 5l7 12" /><path d="M8 13h8" /></>),
  sequence: (<><circle cx="7" cy="12" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="m10 11 4-2m-4 4 4 2" /></>),
  delivery: (<><path d="M5 5c5 2 9 6 12 14" /><path d="m14 16 3 3 2-4" /></>),
  impact: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v5m0 10v5M2 12h5m10 0h5" /></>),
  release: (<><path d="M4 16c5 0 9-3 12-9" /><path d="m13 6 4 1-1 4" /><path d="M8 20c4-1 8-3 11-7" /></>),
  finish: (<><path d="M5 18h14M8 18c0-6 2-10 4-13 2 3 4 7 4 13" /><path d="M9 9h6" /></>),
};

export function IndicatorIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {INDICATOR_ICONS[name] ?? INDICATOR_ICONS.setup}
    </svg>
  );
}

/**
 * One card in the horizontal rail.
 *
 * `ring` is 0–100 and fills the conic gradient. `value` is what prints in the middle —
 * today a detection confidence, later a score. They are separate props precisely so the
 * ring can keep meaning "how sure" while the number changes meaning.
 */
export function IndicatorCard({
  icon, label, value, ring, ringColor = "#5ed0ff", badge, badgeTone = "neutral",
  active = false, title, onClick, index,
}: {
  icon: string; label: string; value: ReactNode;
  ring: number; ringColor?: string;
  badge?: string; badgeTone?: "good" | "bad" | "neutral";
  active?: boolean; title?: string; onClick?: () => void;
  /** Position in the rail — drives the staggered entrance. */
  index?: number;
}) {
  const badgeCls = badgeTone === "good" ? "bg-acid/10 text-acid"
    : badgeTone === "bad" ? "bg-red-400/10 text-red-300"
    : "bg-white/[.06] text-neutral-400";
  return (
    // `fade` (opacity only), never `rise`: this card has its own active/hover transforms and an
    // entrance animating transform would fight them mid-flight.
    <button type="button" aria-pressed={active} title={title} onClick={onClick}
      style={index === undefined ? undefined : ({ "--i": index } as React.CSSProperties)}
      className={`indicator-card fade ${active ? "active " : ""}rounded-[22px] p-3 text-left`}>
      <span className="active-caret" />
      {badge && <span className={`indicator-delta ${badgeCls}`}>{badge}</span>}
      <div className="flex h-full flex-col items-center justify-start gap-2 pt-2">
        <span className="indicator-score-ring"
              style={{ "--ring-value": `${ring}%`, "--ring-color": ringColor } as React.CSSProperties}>
          <span className="indicator-icon-large"><IndicatorIcon name={icon} /></span>
          <span className="relative z-10 text-center">
            <b className="block text-[2rem] leading-none tracking-[-.05em]">{value}</b>
          </span>
        </span>
        <b className="px-1 text-center text-base leading-[1.1]">{label}</b>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ content */

/** Red/green headline card. Fills from the scorecard's strengths and faults (doc 05 C). */
export function FindingBox({
  tone, icon, title, detail,
}: { tone: "positive" | "negative"; icon: string; title: string; detail: string }) {
  return (
    <div className={`finding-box ${tone}`}>
      <span className="finding-icon">{icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight">{title}</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[.16em] text-white/55">{detail}</p>
      </div>
    </div>
  );
}

/** Prose card — drill, session focus, caveat, narrative. */
export function TipCard({
  eyebrow, title, tone = "plain", children,
}: {
  eyebrow?: string; title?: ReactNode;
  tone?: "plain" | "accent" | "acid"; children?: ReactNode;
}) {
  return (
    <div className={`tip-card${tone === "plain" ? "" : ` ${tone}`}`}>
      {eyebrow && <MicroHead tone={tone === "acid" ? "acid" : tone === "accent" ? "violet" : "muted"}>{eyebrow}</MicroHead>}
      {title && <h3 className="mt-2 text-xl font-semibold">{title}</h3>}
      {children}
    </div>
  );
}

export function StatTile({
  value, label, tone = "acid",
}: { value: ReactNode; label: string; tone?: "acid" | "violet" | "muted" }) {
  const c = tone === "acid" ? "text-acid" : tone === "violet" ? "text-violet" : "text-neutral-300";
  return (
    <div className="stat-tile">
      <span className={`block text-2xl font-bold ${c}`}>{value}</span>
      <span className="text-[8px] uppercase tracking-[.16em] text-neutral-600">{label}</span>
    </div>
  );
}

/**
 * One row of the metric explorer.
 *
 * `bar` is 0–100 and drives the gradient fill; `primary`/`secondary` are the two right-hand
 * number columns. In the sample those are weight and score. Today they are the measured
 * value and its change from address — the same grid, honest content.
 */
export function MetricRow({
  name, tags, bar, moment, momentSub, primary, primaryLabel,
  secondary, secondaryLabel, secondaryTone = "acid", active = false, onPlay, playTitle, playable = true,
}: {
  name: string; tags?: { text: string; tone?: "plain" | "violet" }[]; bar: number;
  moment: string; momentSub?: string;
  primary: ReactNode; primaryLabel: string;
  secondary: ReactNode; secondaryLabel: string; secondaryTone?: "acid" | "violet";
  active?: boolean; onPlay?: () => void; playTitle?: string; playable?: boolean;
}) {
  return (
    <div className={`metric-row ${active ? "active " : ""}grid grid-cols-[minmax(0,1.5fr)_110px_85px_85px_54px]
                     items-center gap-3 rounded-2xl border border-white/[.06] bg-white/[.025] px-3 py-3 transition`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-xs font-semibold">{name}</p>
          {tags?.map((t) => (
            <span key={t.text}
              className={t.tone === "violet"
                ? "rounded-full bg-violet/10 px-2 py-0.5 text-[8px] text-violet"
                : "rounded-full border border-white/10 px-2 py-0.5 text-[8px] uppercase tracking-[.13em] text-neutral-500"}>
              {t.text}
            </span>
          ))}
        </div>
        <div className="metric-bar mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"
             style={{ "--value": `${Math.max(0, Math.min(100, bar))}%` } as React.CSSProperties} />
      </div>
      <div>
        <p className="text-xs font-medium">{moment}</p>
        {momentSub && <p className="mt-1 text-[9px] text-neutral-600">{momentSub}</p>}
      </div>
      <div>
        <p className="text-sm font-bold tabular-nums">{primary}</p>
        <p className="text-[8px] uppercase tracking-wider text-neutral-600">{primaryLabel}</p>
      </div>
      <div>
        <p className={`text-sm font-bold tabular-nums ${secondaryTone === "violet" ? "text-violet" : "text-acid"}`}>
          {secondary}
        </p>
        <p className="text-[8px] uppercase tracking-wider text-neutral-600">{secondaryLabel}</p>
      </div>
      <button type="button" onClick={onPlay} disabled={!playable} title={playTitle}
        className={`grid h-11 w-11 place-items-center rounded-xl ${playable
          ? "bg-white text-canvas" : "border border-line text-neutral-600"}`}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- diagnostics */

export function DataRow({
  label, value, tone = "plain", title,
}: { label: ReactNode; value: ReactNode; tone?: "plain" | "muted" | "warn"; title?: string }) {
  const c = tone === "warn" ? "text-amber-400" : tone === "muted" ? "text-neutral-600" : "text-neutral-100";
  return (
    <div className="data-row" title={title}>
      <span className="text-neutral-500">{label}</span>
      <span className={`${c} tabular-nums font-medium`}>{value}</span>
    </div>
  );
}

/**
 * Coverage bar. `under` draws a second, greyed track behind the main one — used for the
 * MediaPipe-vs-RTMPose comparison, where seeing both at once is the whole point.
 */
export function QualityBar({ label, pct, under }: { label: string; pct: number; under?: number }) {
  const col = pct > 90 ? "#22C55E" : pct > 50 ? "#FACC15" : "#E5484D";
  return (
    <div className="my-1 flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[11px] text-neutral-500">{label}</span>
      <span className="qbar">
        {under !== undefined && <i style={{ width: `${under}%`, background: "#4b5563" }} />}
        <i style={{ width: `${pct}%`, background: col }} />
      </span>
      <span className="w-9 text-right text-[11px] tabular-nums text-neutral-400">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function Chip({
  tone = "plain", className = "", children,
}: { tone?: "plain" | "acid" | "violet" | "warn"; className?: string; children: ReactNode }) {
  const c = tone === "acid" ? "border-acid/20 bg-acid/10 text-acid"
    : tone === "violet" ? "border-violet/25 bg-violet/10 text-violet"
    : tone === "warn" ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
    : "border-white/10 bg-white/[.04] text-neutral-400";
  return (
    <span className={`rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-[.16em] ${c} ${className}`}>
      {children}
    </span>
  );
}
