#!/usr/bin/env node
// PreToolUse guard (Claude Code hook). Hard-blocks Edit/Write to the two files
// the agent must NEVER write: `.env*` (secrets) and `pnpm-lock.yaml` (corrupting
// it has bitten before — always go through `pnpm install`/`add`). `.env.example`
// is allowed (placeholder template). Exit code 2 blocks the tool call and shows
// the stderr message to the model. Scope is intentionally tiny so the per-edit
// cost stays negligible.
import { basename } from "node:path"

let raw = ""
process.stdin.on("data", (chunk) => {
  raw += chunk
})
process.stdin.on("end", () => {
  let filePath = ""
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path ?? ""
  } catch {
    // No parseable input — fail open (don't block on a malformed hook payload).
    process.exit(0)
  }

  const base = basename(filePath)
  const isEnv = /^\.env(\.|$)/.test(base) && !base.endsWith(".example")
  const isLockfile = base === "pnpm-lock.yaml"

  if (isEnv || isLockfile) {
    const reason = isLockfile
      ? "pnpm-lock.yaml must never be hand-edited — run `pnpm install` / `pnpm add` instead."
      : `${base} holds secrets and must never be written by the agent — edit .env.local manually, and commit only .env.example with empty values.`
    process.stderr.write(`Blocked edit to ${base}: ${reason}\n`)
    process.exit(2)
  }

  process.exit(0)
})
