#!/usr/bin/env node
// PostToolUse hook (Claude Code). After an Edit/Write to a TS/TSX file under
// apps/web, run ESLint on JUST that file and surface any ERRORS back to the
// model so they get fixed in-flow instead of surfacing later at step
// Verification. REPORT-ONLY: it never rewrites the file (no --fix), so it can't
// collide with an in-progress multi-file edit or leave the model's view stale.
//
// Contract: exit 2 with the lint report on stderr → Claude Code feeds it back to
// the model (the tool already ran; this is advisory, not a block). Exit 0 = no
// errors / not applicable / anything went wrong (FAIL OPEN — a broken hook must
// never wedge editing). Scope is intentionally tiny so the per-edit cost stays
// negligible: only apps/web *.ts/*.tsx, 20s cap, errors-only.
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const appsWeb = resolve(repoRoot, "apps", "web")
const eslintBin = resolve(appsWeb, "node_modules", "eslint", "bin", "eslint.js")

let raw = ""
process.stdin.on("data", (c) => (raw += c))
process.stdin.on("end", () => {
  try {
    const filePath = JSON.parse(raw)?.tool_input?.file_path ?? ""
    if (!filePath) process.exit(0)

    const norm = filePath.replace(/\\/g, "/")
    const isWebTs = norm.includes("/apps/web/") && /\.(ts|tsx)$/.test(norm) && !norm.endsWith(".d.ts")
    if (!isWebTs) process.exit(0)
    if (!existsSync(eslintBin)) process.exit(0) // deps not installed — fail open

    // Default (stylish) formatter — ESLint v9 removed `compact`/`unix` from core.
    const res = spawnSync(process.execPath, [eslintBin, filePath], {
      cwd: appsWeb,
      timeout: 20000,
      encoding: "utf8",
    })

    // ESLint: status 0 = clean, 1 = lint errors found, 2 = fatal config/internal
    // error, null = timed out. Only 1 is actionable for the model; everything
    // else fails open so the hook never nags about its own breakage.
    if (res.status !== 1) process.exit(0)

    const out = (res.stdout || "").trim().split("\n").slice(-40).join("\n")
    process.stderr.write(
      `Post-edit lint (advisory) — ESLint found errors in ${norm}:\n${out}\n` +
        `Fix these before continuing if this file is part of your current change.\n`,
    )
    process.exit(2)
  } catch {
    process.exit(0) // any failure → fail open
  }
})
