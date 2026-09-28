# UI Redesign Progress — "Chromatic Calm"

Prime directive: zero logic/feature changes. Visual + UX-hierarchy only. Both modes verified everywhere. AA contrast. Motion via transform/opacity only. Reduced-motion respected.

## Phase 1 — Audit + baseline (DONE)
- Read shell, sidebar-data (103 items), theme, all ui primitives, all panel dashboards.
- Baseline screenshots: 16 (light+dark × 5 dashboards + 3 inner pages) in `.tmp-e2e/shots/`.
- Pre-existing issues (verify only): sidebar shows only "Dashboard" in baseline (feature-gating/load timing); KPI 502s; packing camera log.

## Phase 2 — Tokens (DONE, commit f6295e02)
- theme.css rewritten: Chromatic Calm neutrals (canvas/surface/surface-raised/sunken/border/ink/ink-muted) + 7 brand hues (indigo primary, emerald, amber, rose, sky, violet, teal) each solid/soft/border/ink, light+dark. Radius 10/8/999. Soft shadows (light only). Motion tokens.
- index.css: 2px brand focus ring, 2px offset (always visible).
- dashboard.css: component layer — .kpi-card (10px, faint tint, 2px top accent), .kpi-value (26-28px/650 tabular), .kpi-icon-badge (28px), .chart-card, .dash-table (44px rows, hairline, no zebra, sunken sticky header), .tap-h (36px), .animate-rise, .skeleton-shimmer, .seg-control/.seg-thumb/.seg-item (segmented), .status-pill, .page-header, .nav-item/.nav-chip, .panel-accent-line, .empty-state. Reduced-motion disables all.
- App looks nearly unchanged but token-driven. Build + 739 tests green.

## Phase 3 — Shell (DONE, commit bb3bda93)
- header.tsx: 64→56px (h-14), canvas bg, 1px hairline + 2px panel-accent line (inset shadow), subtle scroll shadow (no heavy blur block).
- main.tsx: page padding 16px mobile / 24px desktop.
- authenticated-layout.tsx: data-panel attr on SidebarInset → --panel-accent per panel (operational=indigo, monitoring=amber, hr=violet, packing=teal). Packing layout gets the accent line.
- team-switcher.tsx: compact chip (panel icon in tinted square + name + subtitle + chevron); dropdown = clean list, current panel checked (Check icon), per-panel icons (Package/ShieldCheck/Users/Boxes).
- DashboardWrapper: mon + op page headers restyled to shared pattern (32px icon chip + 20px/600 title + subtitle + segmented controls), accent line, consistent padding.
- Build + 739 tests green.

## Phase 4 — Sidebar (DONE, commit <this>)
- Model: flat `items` array (tests pass) + `section: {label, hue}` field on each item. Renderer groups consecutive items by section, renders non-clickable label between groups. Order preserved, nothing dropped.
- sidebar-data.ts: operational reordered into Sales/Catalog/Growth/Finance/Tools (Dashboard alone at top). monitoring → Overview/Security/System. hr → People/Payroll/Time/System. Every item/route/feature/permission preserved.
- nav-group.tsx: section labels (10px muted tracking-wide), 20px group-hue icon chips, active = soft brand bg + brand-ink + 2px rounded left indicator (overrides built-in accent variant), tooltip on truncate.
- sidebar.tsx: width 15→14.5rem, rail 48→56px.
- app-sidebar.tsx: scroll-fade masks (top/bottom) on SidebarContent.
- types.ts: section field on BaseNavItem; removed unused NavSection/sections.
- Build + 739 tests green. Light screenshot verified (section labels + hue chips + active indicator + pinned footer).

## Phase 5 — Shared components
## Phase 6 — Panel dashboards + inner pages + panel tint
## Phase 7 — Motion/performance
## Phase 8 — Final QA

---
Decisions log:
- Kept token NAMES (success/danger/...) so existing component classes auto-pick-up Chromatic Calm values — minimal churn, single source of truth.
- accent-pink kept as an 8th accent (existing KPI assignments) — brief lists 7 core hues; pink is an extra, not a replacement.
- Sidebar model = flat items + section field (not nested sections) so existing flat-structure tests pass unchanged.
- Panel tint only in switcher chip + 2px line under top bar (per brief). Brand/buttons/focus never change per panel.
- Op dashboard keeps its sticky title header (no search top bar) — pre-existing structural difference; page-header visual style now consistent with mon.
