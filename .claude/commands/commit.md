Commit all staged and unstaged changes with a concise conventional commit message.

Steps:
1. Run `git add -A`

2. **Pre-commit secret & sensitive-file scan (BLOCKING — never skip this step).**
   Scan what is now staged. If ANYTHING below trips, STOP: do not write a message, do not run `git commit`. Report findings and remediation, then end. Only proceed past a finding if the user explicitly confirms it is a false positive (e.g. a placeholder or an `.example` file).

   **2a. Sensitive filenames.** Run `git diff --cached --name-only`. ABORT if any staged path matches these (they must be gitignored, never committed):
   - `.env`, `.env.local`, `.env.*.local`  (but `*.example` files ARE allowed — they hold placeholders)
   - `.mcp.json`
   - `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`
   - `*service-account*.json`, `*credentials*.json`, `*.secret`, `*.secrets`

   **2b. Secret content patterns.** Prefer `gitleaks` if it is installed:
   ```
   gitleaks protect --staged --redact --no-banner
   ```
   If `gitleaks` is not available, scan the staged diff (`git diff --cached -U0`) for the patterns below. Report each hit as `path:line — <rule name>` with the matched value REDACTED — never print a real secret into the chat or commit:
   - `sk_live_`, `sk_test_`, `pk_live_`, `rk_live_`, `whsec_`  — Stripe-shaped keys / webhook secret
   - `ghp_`, `gho_`, `github_pat_`  — GitHub tokens
   - `AKIA[0-9A-Z]{16}`  — AWS access key id
   - `-----BEGIN [A-Z ]*PRIVATE KEY-----`  — private keys
   - `(postgres|postgresql)://[^\s:]+:[^\s@]+@`  — DB connection URLs with passwords (this project's `DATABASE_URL`)
   - `eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.`  — JWT-shaped token
   - `(?i)(api[_-]?key|secret|token|password|passwd|auth)["']?\s*[:=]\s*["'][^"']{16,}["']`  — generic assigned secret with a long value
   - `ROBOFLOW_API_KEY\s*[:=]\s*["'][^"']{16,}["']`  — this project's Roboflow key (club-detector dataset fetch)

   **2c. On any hit — STOP and guide remediation:**
   - Sensitive file staged → `git rm --cached <file>`, add it to `.gitignore`, commit a `<file>.example` with placeholders instead.
   - Secret in code/config → remove it, move the value to a gitignored `.env`/`.env.local` file, and **rotate** the secret (assume it is compromised the moment it was staged).
   - Then re-run `/commit`.

3. Run `git diff --cached --stat` to see what changed
4. Write a single commit message. Rules:
   - Format: `type: short description`
   - Types: feat, fix, refactor, chore, docs, style, test
   - Description: max 8 words, lowercase, no period
   - Combine everything into ONE commit regardless of how many features
   - Do NOT split into multiple commits
   - Do NOT write bullet points or body text
   - Examples of GOOD messages: `feat: add reanalyze progress polling`, `fix: club trace gap at impact`, `chore: update dependencies`, `refactor: simplify overlay menu`
   - Examples of BAD messages: `feat: implement comprehensive club head tracking with kalman gating and confidence-weighted trace smoothing` — TOO LONG
5. Run `git commit -m "the message"`
6. Run `git push`. If the current branch has no upstream, run `git push -u origin HEAD` instead. If the push fails (e.g. remote is ahead), report the failure and what to do — do NOT force-push.
7. Report what was committed and that it was pushed. One line. If the safety scan blocked the commit, report that instead — do not silently skip it (and do not push).
