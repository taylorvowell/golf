# Standing AI-Coder Rules — pointer

The canonical, binding rules file produced by this review lives at
[`.claude/rules/react-native.md`](../../rules/react-native.md), scoped by `paths:` frontmatter to
`apps/mobile/**` — the same mechanism as the project's existing `nextjs.md` / `typescript.md` /
`tailwind-v4.md` / `testing.md` rules, so it loads for any future session touching mobile code
without anyone remembering this audit exists.

It is deliberately **not** duplicated here: a fact written in two places drifts, and the copy that
is wrong is the one someone reads (root `CLAUDE.md`'s own rule). Edit the rules file, never a copy.

What it covers, in one line each:

- **Measure, don't argue** — FrameSyncPanel numbers gate every hot-path change; D23-class
  decisions are reversed only by measurement.
- **The 60 Hz hot path** — refs for per-frame reads, effects for mirror writes, primitives across
  memo boundaries, per-artifact vs per-frame compute split, element identity as a tool, draw
  `target ?? presented`.
- **The analysis.json contract on a phone** — truncation, no literal keypoint indices, analyzer
  owns handedness, corrections at render time, `frame / fps` on Android (D40), shared constants
  live in `@swingsage/schema`.
- **Lifecycle** — cleanup everything, abort every fetch, time out every request, respect
  AppState, re-resolve auth on token refresh, deterministic native release.
- **Native config** — CNG only (app.json + `prebuild --clean`), R8 on in release,
  no dep without an import site or a register entry.
- **UI & accessibility** — tokens over hand-mixed values, every control accessible, insets
  everywhere, nothing dev-only in release.
- **Data & state** — discriminated unions, one ApiClient, stale-while-revalidate, degrade never
  crash.
- **Testing & docs** — typecheck+tests+checkoverlay, behaviour-pinning tests, decisions edited in
  the same session.

Related durable records made by this review:

- `docs/decisions/mobile-client.md` — new **Standards** entry naming the rules file as binding.
- Root `CLAUDE.md` — the frame-sync seek rule now carries its platform qualifier (web
  `(frame+0.5)/fps` vs Android `frame/fps`, D40).
- `apps/mobile/AGENTS.md` — points mobile-scoped sessions at the rules file.
