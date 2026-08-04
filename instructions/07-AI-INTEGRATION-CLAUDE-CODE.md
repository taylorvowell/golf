# 07 — AI Integration: Claude Code Locally, API in Production

Requirement: local development must use the developer's installed **Claude Code** (billed
to their Claude subscription), **not** an Anthropic API key. Production later uses the API.
Solution: a provider abstraction with three interchangeable backends.

## 1. Where the app uses AI (complete list)

| Call site | Input | Output (all strict JSON) | Doc |
|---|---|---|---|
| `pose.correct` | ≤10 keyframe images w/ skeleton drawn + span metadata | joint corrections | 03 §4 |
| `club.correct` | ≤10 keyframe images w/ shaft/head drawn | shaft/head corrections | 04 Layer E |
| `events.disambiguate` | 3–5 candidate frames | chosen event frame | 05 A |
| `face.checkpoints` | head-crop images at A/TU/T | square/open/closed classes | 04 §6 |
| `stats.parse` | simulator screen image | simulator-stats schema | 06 §1 |
| `impact.parse` | bird's-eye impact image | impact-image schema | 06 §2 |
| `coach.narrate` | metrics JSON + scorecard + 8 event images | coach report schema | 05 C2 |
| `trends.note` (later) | trend JSON | short progress note | 05 C3 |

Design rules: every call = (versioned prompt template in `ai/prompts/`, JSON Schema for
output, image list, temperature 0). Responses validated with AJV/zod; one retry with the
validation error appended; then fallback (skip correction / mark parse failed / template
narrative).

## 2. Provider Abstraction

```ts
// packages/shared/ai.ts
export interface AIProvider {
  complete(req: {
    promptId: string;            // resolves template + schema
    variables: Record<string, unknown>;
    images?: string[];           // absolute file paths (local) — providers adapt
    maxTokens?: number;
  }): Promise<{ json: unknown; raw: string; provider: string; ms: number }>;
}
```
Implementations:
- **`ClaudeCodeProvider`** (local dev default)
- **`AnthropicAPIProvider`** (production; standard messages API with base64 images)
- **`MockProvider`** (CI/tests; returns canned fixture JSON per promptId — the whole
  pipeline must run green with mocks and no AI at all)

Selection via env: `AI_PROVIDER=claude-code|anthropic|mock`.

## 3. ClaudeCodeProvider — how it works

Claude Code has a **headless/non-interactive mode**: `claude -p "<prompt>" --output-format json`
runs one turn and prints the result. It authenticates with whatever the developer's
`claude` CLI is already logged in as (subscription login) — no API key in the project.

Implementation details:
1. Spawn the CLI from Node (`execFile('claude', args)`) with:
   - `-p` / `--print` non-interactive mode, prompt passed via stdin (avoids arg-length
     limits with big metric JSON payloads).
   - `--output-format json` and parse the `result` field.
   - `--allowedTools "Read"` only (see next point), and run with `--strict-mcp-config`/no
     project settings by setting `cwd` to an isolated scratch dir so the user's own
     CLAUDE.md/config can't leak into prompts. Disallow all other tools — this is a pure
     completion call, not an agent.
   - A per-call timeout (60–120s) and one retry on nonzero exit.
2. **Images**: Claude Code can read image files with its Read tool. The provider copies
   input images into the scratch dir and the prompt says: "Read the image file(s) at
   ./img_01.png ... then respond with ONLY the JSON object matching the schema below."
   (Verify early in Phase 1 that image Read works in `-p` mode on the dev machine; if a CLI
   version has trouble, fallback: `--allowedTools ""` and inline the image as a
   base64 data block is NOT supported via plain -p prompt text — so the Read-tool path is
   the required approach; treat any regression here as a blocker to fix by pinning CLI
   version.)
3. **JSON discipline**: prompts end with "Output ONLY valid JSON matching this schema.
   No prose, no markdown fences." Strip fences defensively anyway; validate; retry with
   error message if invalid.
4. **Concurrency**: serialize calls through a small queue (1–2 concurrent) — the CLI is
   heavyweight per invocation and subscription rate limits apply.
5. **Caching**: hash(promptId + variables + image bytes) → cache JSON result on disk.
   Re-running analysis on the same swing costs zero AI calls. Enormously useful in dev.

### Alternative transport (if shelling out gets painful)
The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) provides a programmatic
`query()` wrapper around the same engine. Note the licensing nuance: Anthropic's current
docs state the Agent SDK expects API-key authentication, while running the **Claude Code
CLI itself** under your own subscription login on your own machine for personal/dev use is
the normal, supported thing. So: default to the CLI-spawn approach for subscription-based
local dev; use the Agent SDK when running with an API key (it can actually serve as the
production provider too). Keep both behind `AIProvider` and this never touches feature code.

### Compliance notes (put in README of ai/)
- Local Claude Code usage = developer's personal subscription, personal machine, dev/test
  only. Fine.
- **Never** ship a product where end-users' requests are served by someone's subscription
  login; production traffic must use API keys (Anthropic explicitly disallows offering
  claude.ai login/limits to third parties). The provider abstraction exists precisely so
  the switch is one env var.

## 4. AnthropicAPIProvider (production)
Standard `POST /v1/messages` with `claude-sonnet-4-6` (or current mid-tier) for parses and
corrections; consider the top model for `coach.narrate` only. Images as base64 content
blocks. Same templates/schemas/caching. Add spend logging per call site.

## 5. Prompt Management
`ai/prompts/<promptId>/v<N>/{prompt.md, schema.json, examples/}`. Prompt version recorded
in outputs (e.g., coach report stores `prompt: coach.narrate@v3`). Add 2–3 few-shot
examples for `stats.parse` (screenshot + ideal JSON) — biggest accuracy lever there.

## 6. Testing AI Pieces
- Contract tests: every promptId's schema validates its fixture outputs.
- `MockProvider` in CI; a manual `pnpm ai:smoke` script runs each call site once through
  ClaudeCodeProvider against fixtures and prints validation results — run this after any
  prompt change.
- Log every AI exchange (prompt hash, duration, valid/invalid, retries) to a local
  `ai_calls` table for debugging.
