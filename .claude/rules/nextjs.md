---
paths:
  - "apps/web/**/*.{ts,tsx}"
---

# Next.js Rules

- App Router only (`src/app`). No `pages/` directory.
- RSC (React Server Components) by default. Add `'use client'` only for: browser APIs, hooks (`useState`, `useEffect`), event handlers, canvas/video imperative control (`SwingStage`, `usePlayer`).
- Keep `'use client'` at leaf nodes — the player/workspace components need it (frame-sync, canvas drawing, transport controls), but data-fetching and layout composition around them stay server components where possible.
- API routes under `src/app/api/**` follow the job/polling contract (see root `CLAUDE.md`) — job state lives in Postgres (`jobs` table), not in-memory across requests, except the in-process map that mirrors an actively-running job so the hot per-frame stdout path never round-trips the DB.
- Server-only modules that touch Postgres (`lib/scoring.ts`, `db/*`) must never be imported from a `"use client"` component — that pulls the Postgres client into the browser bundle. Client-safe types/helpers belong in a separate module (see `lib/scoreDisplay.ts` vs `lib/scoring.ts` for the pattern this project already uses).
- Use `next/font` if adding custom fonts — none are in use yet, so don't introduce a font-loading regression when you do.
- Video/image assets are served from disk (`SWINGSAGE_MEDIA_ROOT` / `out/<id>/`), not a CDN — don't assume `next/image` remote-pattern config or an image CDN exists unless you've checked `next.config.ts`.
