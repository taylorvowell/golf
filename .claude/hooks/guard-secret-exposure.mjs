#!/usr/bin/env node
// PreToolUse guard (Claude Code hook). Blocks the secret-exposure shapes that
// CANNOT be expressed as static permission `deny` rules (which match tool/command
// names, not their contents):
//
//   Bash — environment enumeration and `.env` reads. This catches the *content*
//   shapes a deny rule can't see: bare env enumeration (`printenv`, `gci env:`) —
//   dangerous because Railway/Vercel tokens are mirrored into the Windows user
//   env on this machine — reading a `.env*` secrets file, and secret-injection
//   wrappers (`railway ssh "..."`) piping an env dumper. A legit `railway ssh
//   "... healthz"` health check has no env token, so it passes.
//
// Exit 2 blocks the call and shows the stderr reason to the model. Fails OPEN on
// an unparseable payload (mirrors guard-protected-paths.mjs — never block on
// malformed input).

let raw = ""
process.stdin.on("data", (chunk) => {
  raw += chunk
})
process.stdin.on("end", () => {
  let tool = ""
  let input = {}
  try {
    const parsed = JSON.parse(raw)
    tool = parsed?.tool_name ?? ""
    input = parsed?.tool_input ?? {}
  } catch {
    process.exit(0) // malformed payload — fail open
  }

  const block = (reason) => {
    process.stderr.write(`Blocked (secret-exposure guard): ${reason}\n`)
    process.exit(2)
  }

  if (tool === "Bash") {
    const cmd = String(input?.command ?? "")

    // a) Bulk environment enumeration run directly (mirrored tokens live in the user env).
    const directDump = [
      /\bprintenv\b(?!\s+[A-Za-z_])/i, // `printenv` / `printenv | ...` (no specific var) = dump all
      /\b(?:get-childitem|gci|ls|dir|gp|get-item)\s+env:/i, // PowerShell env: drive enumeration
      /\[environment\]::getenvironmentvariables/i,
      /(^|[|&;])\s*env\s*($|[|&;>])/i, // bare `env` as its own command (POSIX), piped/redirected/terminated
    ]
    if (directDump.some((re) => re.test(cmd))) {
      block("command enumerates all environment variables — that dumps mirrored secrets (Railway/Vercel tokens) into the transcript. Read a single var by name if you truly need it.")
    }

    // b) Reading a secrets-bearing .env file (`.env`, `.env.local`, `.env.production`, ...).
    //    `.env.example` / `.env.sample` are templates and stay allowed.
    if (/\b(?:cat|type|more|bat|less|head|tail|gc|get-content)\b[^\n|]*\.env\b(?!\.example|\.sample)/i.test(cmd)) {
      block(".env* files hold secrets and must never be printed. Only .env.example is readable.")
    }

    // c) Secret-injection wrappers (e.g. `railway ssh`) piping an env dumper.
    const wrapper = /\brailway\s+ssh\b/i.test(cmd)
    const dumper = /\b(?:printenv|env|export)\b/i.test(cmd)
    if (wrapper && dumper) {
      block("runs an env dumper through a secret-injection wrapper — that exposes the service's runtime secrets. Run only the specific non-secret command you need (e.g. a health check).")
    }

    process.exit(0)
  }

  process.exit(0)
})
