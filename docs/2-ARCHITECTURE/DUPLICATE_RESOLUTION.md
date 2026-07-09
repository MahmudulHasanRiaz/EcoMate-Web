# Duplicate & Conflict Resolution

> **Status:** Draft — Phase 8  
> **Supersedes:** Conflict tracking from Phase 1 audit

## Conflicts #1-9 Resolution Status

| # | Conflict | Resolution | Status |
|---|----------|-----------|--------|
| 1 | `features_plan.md` vs `final-feature-plan.md` | `features_plan.md` tagged `# Superseded by: docs/1-BUSINESS/FEATURE_REGISTRY.md`. Content will be extracted to FEATURE_REGISTRY.md in Phase 9-10. | ✅ Superseded tag added |
| 2 | Root `AGENT.md` vs `storefront/AGENTS.md` | No resolution needed — different scopes (global vs storefront). Confirmed to keep both. | ✅ No action |
| 3 | README claims vs implementation | README.md largely accurate. Backend README, Admin README, Storefront README all stale — replaced content pending. | 🟡 Phase 10 |
| 4 | Implementation plans vs actual backend | 27 plans tagged Superseded. 4 active plans remain. | ✅ Superseded tags added |
| 5 | Terminology inconsistencies | 7 canonical terms established in TERMINOLOGY_ALIGNMENT.md. Fixes deferred to Phase 10. | ✅ Documented |
| 6 | Missing ADRs | 6 ADRs created in Phase 5. | ✅ Written |
| 7 | Dual stock tracking (InventoryLog + ManagedStockLedger) | ADR 003 documents as technical debt. Migration path identified. | ✅ Documented |
| 8 | License claim (68 features) vs partial implementation | FEATURE_REGISTRY.md created. Verification deferred to Phase 9. | 🟡 Phase 9 |
| 9 | Storefront data fetching patterns | Need deeper investigation in Phase 9. | 🟡 Phase 9 |

## Resolution Summary

| Closed in Phase 2 | Closed in Phase 5 | Pending Phase 9-10 |
|-------------------|-------------------|-------------------|
| Conflicts 1, 2, 4 | Conflict 6 | Conflicts 3, 5, 7, 8, 9 |