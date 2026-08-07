#!/usr/bin/env node
// scripts/roadmap/derive.mjs
//
// Deterministic derivation behind the `roadmap` skill (`/roadmap`). Reads .claude/ROADMAP.json (declarations only)
// + every track's statusFile, computes each rollup, runs the four cross-track consistency checks, regenerates
// .claude/ROADMAP.md, and prints the check results. This is the SINGLE source of derivation logic — the roadmap
// SKILL.md prose mirrors it; keep them in lockstep.
//
// Anti-drift invariant: NEVER writes status into ROADMAP.json. The only file written is ROADMAP.md.
// Usage: node scripts/roadmap/derive.mjs [--date YYYY-MM-DD]  (exit 1 if the spine-uniqueness ERROR fires)
//
// Handles a missing or empty ROADMAP.json gracefully — this project starts with no tracks at all, and that's a
// normal state, not an error. In that case it writes a short "no tracks yet" ROADMAP.md and exits 0.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ROADMAP_JSON = join(ROOT, ".claude/ROADMAP.json")
const ROADMAP_MD = join(ROOT, ".claude/ROADMAP.md")
const dateArg = process.argv.indexOf("--date")
const GEN_DATE = dateArg !== -1 ? process.argv[dateArg + 1] : new Date().toISOString().slice(0, 10)

// ---- no tracks yet: missing or empty ROADMAP.json is a normal, not an error, state ----
const hasRoadmapFile = existsSync(ROADMAP_JSON)
const rm = hasRoadmapFile
  ? JSON.parse(readFileSync(ROADMAP_JSON, "utf8"))
  : { phases: [], tracks: [], shared: [] }

if (!rm.tracks || rm.tracks.length === 0) {
  const md = `# SwingSage Roadmap — generated ${GEN_DATE}

No tracks yet. Scaffold the first one (see the \`roadmap\` skill's "Adding a track" section — create
\`.claude/feature-tracks/<id>/\` with \`_STATUS.json\` + \`_PROGRESS.md\`, add a \`tracks[]\` entry to
\`.claude/ROADMAP.json\`, then re-run this script) and re-run \`node scripts/roadmap/derive.mjs\`.
`
  writeFileSync(ROADMAP_MD, md)
  console.log(hasRoadmapFile ? "ROADMAP.json has no tracks yet." : ".claude/ROADMAP.json does not exist yet.")
  console.log("ROADMAP.md regenerated with a 'no tracks yet' placeholder.")
  process.exit(0)
}

const phases = [...(rm.phases || [])].sort((a, b) => a.order - b.order)
const phaseOrder = Object.fromEntries(phases.map((p, i) => [p.id, i]))
const phaseLabel = (id) => {
  const p = phases.find((x) => x.id === id)
  return p ? p.label.split(" (")[0] : id
}
const lifeById = Object.fromEntries(rm.tracks.map((t) => [t.id, t.lifecycle]))

function rollup(t) {
  const sf = join(ROOT, t.statusFile)
  if (!existsSync(sf))
    return {
      total: 0,
      complete: 0,
      inProgress: 0,
      blocked: 0,
      skipped: 0,
      current: "—",
      pct: "—",
      missing: true,
    }
  const s = JSON.parse(readFileSync(sf, "utf8"))
  const steps = Object.values(s.steps || {})
  const total = steps.length
  const c = (v) => steps.filter((x) => x.status === v).length
  const base = {
    total,
    complete: c("complete"),
    inProgress: c("in-progress"),
    blocked: c("blocked"),
    skipped: c("skipped"),
    current: s.currentStep,
  }
  if (s.currentStep === "complete") return { ...base, pct: 100 } // sentinel
  return { ...base, pct: total ? Math.round((100 * base.complete) / total) : "—" }
}

const data = {}
for (const t of rm.tracks) data[t.id] = rollup(t)

// ---- four consistency checks ----
const active = rm.tracks.filter((t) => t.lifecycle === "active")
const spines = rm.tracks.filter((t) => t.spine && t.lifecycle === "active")
const spineErr = spines.length !== 1
const spineMsg = spineErr
  ? `❌ spine: ${spines.length} active spine tracks (${spines.map((t) => t.id).join(", ") || "none"}) — /build has no unambiguous target`
  : `✅ spine: exactly one active (${spines[0].id})`

const depWarn = []
for (const t of rm.tracks) {
  const r = data[t.id]
  const started = r && (r.complete > 0 || r.inProgress > 0)
  if (!started || !t.dependsOn) continue
  for (const d of t.dependsOn) {
    const hard = d.blocking !== false // default true
    if (!hard) continue // soft = sequencing note, not a warning
    const dr = data[d.track]
    const depDone =
      (dr && dr.total > 0 && dr.complete + (dr.skipped || 0) === dr.total) ||
      lifeById[d.track] === "complete"
    if (!depDone)
      depWarn.push(`${t.id} has started work but its HARD dep ${d.track} is not complete`)
  }
}

const shared = new Set(rm.shared || [])
const ownWarn = []
for (let i = 0; i < active.length; i++)
  for (let j = i + 1; j < active.length; j++) {
    const A = active[i],
      B = active[j]
    for (const ga of A.owns || [])
      for (const gb of B.owns || []) {
        if (shared.has(ga) || shared.has(gb)) continue
        const na = ga.replace(/\/?\*+.*$/, ""),
          nb = gb.replace(/\/?\*+.*$/, "")
        if (na && nb && (na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/")))
          ownWarn.push(`${A.id} & ${B.id}: ${ga} ~ ${gb}`)
      }
  }

const lifeWarn = []
for (const t of rm.tracks) {
  const r = data[t.id]
  if (!r || r.pct === "—") continue
  if (t.lifecycle === "complete" && r.pct !== 100)
    lifeWarn.push(`${t.id}: lifecycle complete but ${r.complete}/${r.total}`)
  if ((t.lifecycle === "active" || t.lifecycle === "planned") && r.pct === 100)
    lifeWarn.push(`${t.id}: lifecycle ${t.lifecycle} but 100%`)
}

// ---- regenerate ROADMAP.md ----
const tracks = [...rm.tracks]
  .map((t, i) => ({ t, i }))
  .sort((a, b) => (phaseOrder[a.t.phase] ?? 0) - (phaseOrder[b.t.phase] ?? 0) || a.i - b.i)
  .map((x) => x.t)
let rows = ""
for (const t of tracks) {
  const r = data[t.id]
  const name = t.spine ? `**${t.id}** (spine)` : t.id
  const goal = t.goal.length > 78 ? t.goal.slice(0, 76) + "…" : t.goal
  const extra = r.inProgress ? `, ${r.inProgress} in-prog` : r.skipped ? `, ${r.skipped} skip` : ""
  const blocked =
    t.lifecycle === "blocked" && t.unblockTrigger
      ? t.unblockTrigger.split(/[.;]/)[0].slice(0, 52)
      : "—"
  rows += `| ${name} | ${phaseLabel(t.phase)} | ${goal} | ${r.complete}/${r.total} (${r.pct}${r.pct === "—" ? "" : "%"}${extra}) | ${r.current} | ${t.lifecycle} | ${blocked} |\n`
}

const arc = phases.map((p) => p.label.split(" (")[0]).join(" → ")
const nextSpine = spines[0]
  ? `${spines[0].id} ${data[spines[0].id].current}`
  : "(no active spine — set spine:true on one track)"
const md = `# SwingSage Roadmap — generated ${GEN_DATE}

> Macro source of truth. Declarations live in \`.claude/ROADMAP.json\`; this rollup is DERIVED by \`/roadmap\`
> (\`node scripts/roadmap/derive.mjs\`). Do not hand-edit the table — re-run the script. Single-track detail:
> \`/feature <name> status\`.

## Arc

${arc || "(no phases declared yet)"}

## Tracks

| Track | Phase | Goal | Progress | Current | Lifecycle | Blocked on |
|-------|-------|------|----------|---------|-----------|------------|
${rows}
## Consistency

- ${spineMsg}
- ${depWarn.length ? "⚠ dependency: " + depWarn.join("; ") : "✅ dependency: none"}
- ${ownWarn.length ? "⚠ ownership overlap: " + ownWarn.join("; ") : "✅ ownership overlap: none"}
- ${lifeWarn.length ? "⚠ lifecycle/derived mismatch: " + lifeWarn.join("; ") : "✅ lifecycle/derived: none"}

## Recommended next

Spine: **${nextSpine}** (\`/build\`). Then the other unblocked active/planned tracks per phase order. Externally-blocked
tracks wait on their \`unblockTrigger\`.
`
writeFileSync(ROADMAP_MD, md)

console.log("ROADMAP.md regenerated.")
console.log("Consistency checks:")
console.log("  " + spineMsg)
console.log("  dependency:        " + (depWarn.length ? depWarn.join("; ") : "none"))
console.log("  ownership overlap: " + (ownWarn.length ? ownWarn.join("; ") : "none"))
console.log("  lifecycle/derived: " + (lifeWarn.length ? lifeWarn.join("; ") : "none"))
process.exit(spineErr ? 1 : 0)
