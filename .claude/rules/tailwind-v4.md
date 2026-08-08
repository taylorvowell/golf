---
paths:
  - "apps/web/**/*.css"
  - "apps/web/**/*.tsx"
---

# Tailwind CSS v4 Rules — CRITICAL

Tailwind v4, CSS-first. v3 patterns are errors: NO `tailwind.config.js`/`.ts` (theme lives in CSS `@theme` blocks in `apps/web/src/app/globals.css`), NO `@tailwind base/components/utilities` directives (use `@import "tailwindcss"`), NO content array, NO autoprefixer (PostCSS uses `@tailwindcss/postcss` only). Token prefixes: `--color-*`, `--spacing-*`, `--font-*`. Border default is `currentColor` in v4 — always set explicit border colors. If you generate a `tailwind.config.js` or a v3 directive, you have made an error — stop and fix.

The visual system lives in the app itself: theme tokens in the `@theme` block of `apps/web/src/app/globals.css`, and the card/panel shapes as named components in `apps/web/src/components/ui/kiosk.tsx`. Reuse or extend those rather than inventing a new panel.
