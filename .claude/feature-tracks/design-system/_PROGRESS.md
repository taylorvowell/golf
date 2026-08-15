# design-system — Progress

Track created 2026-08-14 from Taylor's directive: the app's theme and pages must match the
reference mockups in `.claude/ideal-swing-design-system.html` **exactly** — the Swing Log
mockup 100% pixel-perfect, including the scroll behaviours (sheet sliding over the layer
beneath, the sticky pill nav hiding at the top of the report, the full-video controls
appearing in that state). The Progress page ships as a placeholder UI on the same system.
This track builds the reusable React Native design system all future pages are made from,
and supersedes mobile-app-shell step 03 (the deferred styling pass).

## Named deviations from "exact" (declared up front, each logged in docs/decisions/)

- **Font**: Bahnschrift is a Windows-licensed font and cannot be bundled in an app.
  Barlow Semi Condensed (Google Fonts, OFL) is the DIN-family stand-in for display type;
  Inter ships for body type instead of resting on system fallbacks.
- **Backdrop blur**: RN has no backdrop-filter. Glass surfaces use near-opaque theme fills
  (the mockup's glass is already 88–98% opaque, so the visual difference is minimal).
  `expo-blur` stays out until a screen proves the fill isn't enough.
- **conic-gradient score rings** render as SVG arcs (`design/gauges` heritage) — identical
  appearance, different primitive.
- **Brand wordmark**: SETTLED same day — Taylor supplied the real logo and its wordmark
  reads *Swingsage*. Every "Ideal Swing" string in the mockups renders as **SwingSage**;
  the master lockup lives at `apps/mobile/assets/brand/swingsage-logo.svg` and step 02
  builds `BrandLogo`/`BrandMark` from it (full colour on dark/hero, navy-tinted wordmark
  on light).

## Log
