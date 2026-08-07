---
paths:
  - "apps/web/**/*.{ts,tsx}"
---

# TypeScript Rules

- Strict mode always (already on in `tsconfig.json`), no exceptions.
- Never use `any`. Use `unknown` and narrow.
- Data crossing a boundary (API route bodies, `analysis.json`/`coach_report.json` reads, DB rows) should be typed explicitly at the read site — don't trust `JSON.parse` output implicitly.
- Named exports everywhere except `page.tsx` and `layout.tsx` (default required by Next.js).
- One component per file, file name matches component name.
- Props interfaces named `[ComponentName]Props`, defined above the component.
- Path alias: `@/*` maps to `src/*`. No `../../..` imports.
