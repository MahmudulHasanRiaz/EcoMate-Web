# UI Redesign Progress — "Chromatic Calm"

Prime directive: zero logic/feature changes. Visual + UX-hierarchy only. Both modes verified everywhere. AA contrast. Motion via transform/opacity only. Reduced-motion respected.

## Phase 1 — Audit + baseline (DONE)
- Read shell (authenticated-layout, app-sidebar, nav-group, team-switcher, header, main, nav-user, app-title), sidebar-data.ts (103 items, 3 panels + footer), theme.css/index.css/dashboard.css, all ui primitives, all panel dashboards.
- Baseline screenshots: 16 (light+dark × 5 dashboards + 3 inner pages) in `.tmp-e2e/shots/`.
- Findings: token-driven core exists (theme.css → dashboard.css → ui/dashboard.tsx). Packing = self-contained zinc-950 system (dedicated pass). Hardcoded colors in orders/security/business-analytics. mon=config grid, op=hand-placed 7/3.
- Pre-existing issues (not my responsibility, verify only): sidebar shows only "Dashboard" in baseline (feature-gating/load timing); KPI 502s; packing camera log.

## Phase 2 — Tokens (IN PROGRESS)
- Rewrite theme.css: Chromatic Calm neutrals (canvas/surface/surface-raised/sunken/border/ink/ink-muted) + 7 brand hues (indigo primary, emerald, amber, rose, sky, violet, teal) each with solid/soft/border/ink in light+dark. Radius (10/8/999), soft shadows (light only), motion tokens.
- Map @theme inline so existing Tailwind classes (bg-success-soft etc.) pick up new values → app nearly unchanged but token-driven.

## Phase 3 — Shell
## Phase 4 — Sidebar
## Phase 5 — Shared components
## Phase 6 — Panel dashboards + inner pages + panel tint
## Phase 7 — Motion/performance
## Phase 8 — Final QA

---
Decisions log: (appended per phase)
