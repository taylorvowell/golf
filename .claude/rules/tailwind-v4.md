---
paths:
  - "apps/web/**/*.css"
  - "apps/web/**/*.tsx"
---

# Tailwind CSS v4 Rules — CRITICAL

Tailwind v4, CSS-first. v3 patterns are errors: NO `tailwind.config.js`/`.ts` (theme lives in CSS `@theme` blocks in `apps/web/src/app/globals.css`), NO `@tailwind base/components/utilities` directives (use `@import "tailwindcss"`), NO content array, NO autoprefixer (PostCSS uses `@tailwindcss/postcss` only). Token prefixes: `--color-*`, `--spacing-*`, `--font-*`. Border default is `currentColor` in v4 — always set explicit border colors. If you generate a `tailwind.config.js` or a v3 directive, you have made an error — stop and fix.

This project's visual spec is `instructions/template_sample.html` (see root `CLAUDE.md`, D35) — its `<style>` block lives unaltered in `globals.css`, and the `@theme` tokens come from that sample. The sample's card shapes are named components in `components/ui/kiosk.tsx`; use those rather than inventing a new panel.
