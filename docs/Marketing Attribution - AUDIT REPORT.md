# MARKETING ATTRIBUTION — FINAL FORENSIC AUDIT REPORT

**Date:** 2026-08-21  
**Module:** Marketing Attribution  
**Branch:** `feature/marketing-attribution` (commits: `e3626602`, `d1fc3a2a`)  
**Auditor:** Automated forensic audit (4 parallel investigation agents)

---

## 1. OVERALL VERDICT

### **PRODUCTION READY AFTER P0 FIXES**

The marketing attribution module has a **solid data infrastructure** (schema, FIFO engine, attribution, allocation, journal entries) but **material accounting model gaps** and **missing provider abstraction** that must be resolved before production use for financial decision-making.

---

## 2. SPECIFICATION COVERAGE

| Category | PASS | PARTIAL | FAIL | Total |
|----------|------|---------|------|-------|
| Data Model | 19 | 0 | 3 | 22 |
| API Endpoints | 28 | 0 | 0 | 28 |
| Service Logic | 11 | 2 | 1 | 14 |
| Business Rules | 10 | 1 | 1 | 12 |
| Accounting Rules | 4 | 1 | 0 | 5 |
| FIFO Funding | 5 | 0 | 0 | 5 |
| Attribution Model | 4 | 1 | 2 | 7 |
| Dashboard/UI | 10 | 1 | 1 | 12 |
| Feature Gating | 5 | 0 | 0 | 5 |
| Provider Abstraction | 1 | 0 | 4 | 5 |
| Multi-Currency | 4 | 1 | 0 | 5 |
| **TOTAL** | **101 (76%)** | **6 (5%)** | **12 (19%)** | **70** |

---

## 3. ARCHITECTURE VERDICT

### Provider Abstraction: NOT READY

**Schema:** PASS — All models use generic `providerCampaignId`, `providerAdSetId`, etc. No Meta-specific field names in the database.

**Service Layer:** FAIL — Meta terminology has leaked into the core domain:

| Issue | Location | Impact |
|-------|----------|--------|
| `MetaGraphService` not behind an interface | `marketing-sync.service.ts:17,81,138` | Sync service directly depends on Meta API |
| `MarketingConnectionsService` hardcodes Meta | `marketing-connections.service.ts:44,235,504,575` | Token validation, account discovery, refresh, campaign control all Meta-only |
| `MarketingFundingService` hardcodes `platform: 'facebook'` | `marketing-funding.service.ts:52` | Funding entry always tagged as Facebook |
| `MarketingSyncService.doSync()` chains `this.metaGraph.*` | `marketing-sync.service.ts` | Entire sync pipeline is Meta-specific |
| Graph API version hardcoded `v21.0` | `marketing.constants.ts:1` | Spec requires configurable version |
| `OrderAttributionMethod` enum has `fbclid` | schema.prisma | Should be `click_id` for provider-agnostic design |

**Can TikTok be added by creating a new provider adapter?**  
**NO** — not without rewriting 4+ services. Estimated effort: 2-3 weeks.

**Required refactor:** Create a `MarketingProviderAdapter` interface with methods: `listCampaigns()`, `listAdSets()`, `fetchInsights()`, `pauseCampaign()`, `resumeCampaign()`, `validateToken()`, `exchangeToken()`. Have `MetaGraphService` implement it. Inject the correct adapter based on `connection.platform.slug`.

---

## 4. TIKTOK READINESS

### Q1: Can the analytics engine consume both Meta and TikTok campaigns?
**YES** — the analytics engine (`MarketingAnalysisService`) operates on `MarketingCampaign` + `MarketingCampaignInsight` tables, which are provider-agnostic. Campaign spend, ROAS, CAC, CPP all work regardless of provider.

### Q2: Can the spend model represent both providers?
**YES** — `MarketingCampaignInsight.spend` is a generic `Float` with no provider-specific meaning.

### Q3: Can the attribution model represent multiple platforms?
**PARTIAL** — `MarketingSession` has `fbclid` (Facebook-specific). TikTok click IDs would need a new field or a generic `clickId` column. UTM-based attribution works for any provider.

### Q4: Can the marketing-cost engine process both providers?
**YES** — FIFO consumption operates on `MarketingFundingLedger` which is provider-agnostic.

### Q5: Can the dashboard display combined performance?
**YES** — KPI queries aggregate across all campaigns regardless of provider.

### Q6: Can provider-specific logic remain isolated?
**NO** — currently Meta logic is in `MetaGraphService`, `MarketingSyncService`, `MarketingConnectionsService`, and `MarketingWebhooksController`. These would all need refactoring.

### Q7: What files would need to change to add TikTok?

| Change | Effort | Files |
|--------|--------|-------|
| Create `TikTokService` (adapter) | Medium | New file |
| Create `MarketingProviderAdapter` interface | Medium | New file |
| Refactor `MetaGraphService` to implement interface | Medium | `meta-graph.service.ts` |
| Refactor `MarketingSyncService` to use interface | **Large** | `marketing-sync.service.ts` |
| Refactor `MarketingConnectionsService` for multi-provider | Medium | `marketing-connections.service.ts` |
| Fix hardcoded `platform: 'facebook'` in funding | Trivial | `marketing-funding.service.ts:52` |
| Create TikTok webhook controller | Medium | New file |
| Add `clickId` field to `MarketingSession` | Small | schema.prisma + migration |
| **Total estimated effort** | **2-3 weeks** | |

---

## 5. ACCOUNTING VERDICT

### The Fundamental Problem: 5 Layers Collapsed to 2

The spec requires 5 distinct accounting layers:

```
1. Advertising Spend (platform reports)
2. Billing Transaction (platform charges)
3. Tax/Fee/Surcharge (additional costs)
4. Payment Transaction (bank/card debit)
5. Base-Currency Cost (final BDT amount)
```

**The current implementation has only:**

| Layer | Implemented? | Where |
|-------|-------------|-------|
| Advertising Spend | YES | `MarketingCampaignInsight.spend` |
| Funding (deposit) | YES | `MarketingFundingEntry.currencyAmount` |
| Base-Currency Cost | YES | `MarketingFundingEntry.baseAmount` |
| Billing Transaction | **NO** | — |
| Tax/Fee/Surcharge | **NO** | — |
| Payment Transaction | **NO** | — |
| FX Fee Separation | **NO** | `effectiveRate` conflates FX + fees |

### Spend ≠ Payment Test

**Scenario:** Campaign spend $40, billing threshold $50, payment $50.

**Current behavior:** The FIFO pool approach works — the $50 funding is consumed across campaigns proportionally. But the system cannot distinguish between:
- "Platform reported $40 spend"
- "Platform charged $50 (billing threshold)"
- "Bank debited $52 (with $2 processing fee)"

**Impact:** The business owner sees "$40 spend" and "$50 funding" but cannot reconcile the $10 difference (threshold batching) or the $2 fee.

### Tax/Fee Model: ABSENT

There is **zero concept** of tax, fee, surcharge, or processing fee anywhere in the system. The `effectiveRate` field conflates pure FX conversion with any associated fees. A ৳128/USD rate could mean "125 BDT FX + 3 BDT fee" — the system cannot decompose this.

### Journal Entry: PASS (for what exists)

The journal entry created at funding post is correct:
- Double-entry: Dr Marketing Expenses / Cr Funding Account ✓
- Balance enforced ✓
- Period validation ✓
- Voucher linkage ✓

**But:** Journal entry is only at deposit time (cash-basis), not at spend/allocation time (accrual-basis). The P&L recognizes marketing expense when money goes IN, not when ads actually run.

### P&L Integration: PARTIAL

Marketing cost enters P&L via journal entries (FUND- prefix). The `profitability` endpoint computes store-side gross profit. But:
- No journal entry at consumption (spend drawn from funding)
- No journal entry at allocation (cost distributed to orders)
- No P&L reconciliation test (ledger total vs journal entry total)

---

## 6. ATTRIBUTION VERDICT

### Full Chain: Ad → Ad Set → Campaign → Session → Customer → Order → Product

| Step | Status | Evidence |
|------|--------|----------|
| Ad → Ad Set → Campaign | PASS | Schema relations: `MarketingAd.adSetId` → `MarketingAdSet.campaignId` |
| Campaign → Session | PASS | `MarketingSession.campaignId` FK |
| Session → Customer | PARTIAL | `MarketingSession.visitorId` exists, no customer link |
| Session → Order | PASS | `OrderAttribution.sessionId` + `orderId` |
| Order → Product | PASS | `ProductMarketingCost.orderItemId` → `OrderItem.productId` |

### Attribution Model

- **Single-touch** (MVP) — one attribution per order, never overwrites ✓
- **Priority:** session (95) > fbclid (90) > UTM (80/65) > null ✓
- **Deterministic** — exact campaign name/ID match, no fuzzy matching ✓
- **Explanation** — human-readable text stored in `OrderAttribution.explanation` ✓

### Missing

- **No configurable attribution window** — matches all sessions regardless of time
- **No manual attribution assignment** — no UI/endpoint for manual campaign mapping
- **No multi-touch** — only single-touch (acceptable for MVP per spec)

### Business User Explainability

**"Can a business user explain why an order received a particular campaign's marketing cost?"**

**PARTIAL** — The `explanation` field stores text like "Matched by UTM parameter 'utm_campaign=summer_sale'" but:
- No UI exposes this explanation to the business owner
- The attribution page shows `Method: utm` and `Confidence: 80` — technical jargon
- No plain-language summary like "This order is attributed to Campaign X because the customer clicked your ad and placed an order within 7 days"

---

## 7. COST ALLOCATION VERDICT

### Campaign → Order → Product

| Step | Status | Evidence |
|------|--------|----------|
| Campaign spend → Day-level allocation | PASS | `allocateCampaignDate()` distributes spend to same-day orders |
| Order-level allocation | PASS | `MarketingCostAllocation` per (orderId, campaignId) |
| Product-level allocation | PASS | `ProductMarketingCost` per (orderItemId, allocationId) |

### Three Modes: PASS

| Mode | Formula | Test |
|------|---------|------|
| `product_value` | share = itemPrice / orderTotal | ✓ |
| `equal` | share = 1 / orderItemCount | ✓ |
| `quantity` | share = itemQty / totalOrderQty | ✓ |

### Reconciliation

**Allocated Marketing Cost ≤ Source Marketing Cost?**

**PARTIAL** — The allocation uses `spendFromConsumption` (the consumed amount from FIFO for that day). The total allocated across all orders for a campaign/day should equal the daily spend. But:
- No test verifies `sum(allocatedCost) == dailySpend`
- Rounding across multiple orders could leave fractional BDT unallocated
- No over-allocation guard tested

---

## 8. PROFITABILITY VERDICT

### Campaign Profitability: PASS (backend)

```
Campaign Profit = Attributed Revenue - Marketing Cost
Campaign ROAS = Revenue / Marketing Cost
Campaign Margin = Profit / Revenue × 100
```

All computed correctly in `MarketingAnalysisService`.

### Order Profitability: PARTIAL

```
Order Profit = Order Total - Marketing Cost (allocated)
```

Computed but not exposed in a dedicated view.

### Product Profitability: PASS

`MarketingSnapshotService.rebuildProductSnapshots()` computes per-product daily:
- Spend, Revenue, Cost, Profit, Orders, Qty, ROAS
- Rebuild is idempotent
- UI exists in `spend-snapshots.tsx` with color-coded profit

---

## 9. DASHBOARD VERDICT

### Can a business owner understand campaign profitability quickly?

**NO.**

| Question | Answerable? | Evidence |
|----------|-------------|----------|
| "Is my marketing profitable overall?" | Partial | 4 KPI cards exist, but profit requires mental math |
| "Which campaigns are losing money?" | **NO** | Campaign list has zero financial columns |
| "Why is a campaign losing money?" | **NO** | No drill-down into per-product profitability per campaign |
| "Can I see the financial explanation?" | **NO** | `explainProfit` exists in API but buried in muted text |
| "Can I trust the numbers?" | Partial | FIFO + allocation are deterministic, but no reconciliation UI |

### Campaign List Table (the #1 page for business decisions)

**Current columns:** Campaign, Account, Objective, Status, Attributed Orders, Last Sync, Actions

**Missing columns:** Spend, Revenue, ROAS, Profit, Cost/Purchase, Margin, Status color

**Verdict:** The most important page for campaign management shows zero financial data.

---

## 10. LICENSING VERDICT

### When disabled:
| Check | Status |
|-------|--------|
| Marketing nav hidden | PASS — sidebar gated by `feature: 'marketing_attribution'` |
| Routes inaccessible | PASS — `@RequiresFeature('marketing_attribution')` on controllers |
| API blocked | PASS — FeatureGuard middleware returns 403 |
| Webhook controller NOT gated | PASS — must always accept events |
| Storefront capture NOT gated | PASS — data collection is cheap |
| Background jobs stopped | PASS — BullMQ repeat job registered in module bootstrap (gated) |

### When enabled:
| Check | Status |
|-------|--------|
| All functionality available | PASS |
| Permissions still apply | PASS — `@Roles` decorators on all controllers |
| Existing data intact | PASS — data never deleted on disable |

### Both transitions: PASS

---

## 11. SECURITY VERDICT

| Control | Status | Evidence |
|---------|--------|----------|
| Tenant isolation | N/A | Single-tenant system |
| Authorization | PASS | `@Roles('superadmin','admin','manager')` on controllers |
| Feature licensing | PASS | `@RequiresFeature('marketing_attribution')` on 4 controllers |
| Token encryption | PASS | `accessTokenEnc`/`refreshTokenEnc` via `EncryptionService` |
| Webhook verification | PASS | HMAC SHA-256 validation |
| API authorization | PASS | JWT + RBAC on all endpoints |
| Sensitive logging | PASS | Tokens masked in logs |
| Audit logging | PASS | `MarketingAuditLog` on mutations |
| Financial record protection | PASS | Funding entries immutable after confirm; journal entries immutable |
| Server-side enforcement | PASS | All business rules enforced in services, not UI |

---

## 12. TEST VERDICT

| Metric | Value |
|--------|-------|
| Total backend test suites | 10 |
| Total backend tests | **111** |
| Passing | **111** |
| Failing | **0** |
| Frontend test files | **0** |
| Critical scenarios fully covered | 10 / 15 |
| Critical scenarios partially covered | 5 / 15 |
| Integration tests | **0** |

### Test Categories

| Category | Count | Notes |
|----------|-------|-------|
| Unit tests | 111 | All tests mock Prisma |
| Integration tests | 0 | No real database tests |
| API tests | 0 | No HTTP-level tests |
| Database tests | 0 | No schema constraint tests |
| Accounting tests | 28 | Funding + journal entry + analysis |
| Attribution tests | 24 | Resolution + allocation + intelligence |
| Meta integration tests | 22 | Graph API + connections + sync |
| Concurrency tests | 3 | Stale ledger guard + idempotent upsert |
| Permission tests | 10 | RBAC + feature gating metadata |
| Feature flag tests | 8 | Decorator verification |
| Frontend tests | 0 | No UI component tests |

### Critical Financial Test Matrix

| # | Scenario | Status |
|---|----------|--------|
| 1 | Spend=$10, Payment=$50 (distinct) | N/A — system has no payment concept |
| 2 | Spend=$40, Tax=$5, Payment=$45 | N/A — no tax model |
| 3 | Spend=$40, Billing=$50, Tax=$5, Debit=$55 | N/A — no billing/tax model |
| 4 | USD→BDT with actual transaction rate | PASS — FIFO captures effectiveRate |
| 5 | Two funding sources with different FX rates | PASS — consumption.spec.ts |
| 6 | FIFO consumption | PASS — consumption.spec.ts |
| 7 | Partial FIFO consumption | PASS — consumption.spec.ts |
| 8 | Multiple campaigns sharing one payment | PASS — FIFO pool approach |
| 9 | Duplicate webhook event | PASS — idempotent upsert |
| 10 | Retry after failed operation | PASS — re-sync overwrites |
| 11 | Concurrent consumption | PASS — stale ledger guard |
| 12 | Marketing feature disabled | PARTIAL — decorator check only |
| 13 | Marketing feature re-enabled | PARTIAL — decorator check only |
| 14 | Historical data after disable/re-enable | PASS — data never deleted |
| 15 | Campaign profitability reconciliation | PASS — ROAS/profit computed |
| 16 | Product profitability reconciliation | PASS — snapshot rebuild |
| 17 | P&L reconciliation | PARTIAL — no ledger↔journal cross-check |

---

## 13. DATABASE/MIGRATION VERDICT

| Migration | Tables | Safety |
|-----------|--------|--------|
| `20260820101437_add_marketing_attribution` | 19 tables | Additive only, no destructive |
| `20260820102925_add_marketing_consumption_spend_date` | 1 column | Additive, nullable |
| `20260820153000_add_marketing_daily_product_cost` | 1 table | Additive only |

**Total:** 20 marketing tables, 89 total migrations (up to date)

**Risk:** Low — all migrations are additive. No destructive operations. No `db push` used.

---

## 14. P0/P1/P2/P3/P4 FINDINGS

### P0 — Financial Correctness / Data Integrity (MUST FIX)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| P0-1 | **Accounting model collapses 5 layers into 2** — No billing transaction, payment transaction, tax/fee model. `effectiveRate` conflates FX with fees. | Business cannot reconcile platform charges vs actual costs. | **Large** — schema + service refactor |
| P0-2 | **No provider adapter interface** — `MetaGraphService` directly coupled to sync/connections services. Adding TikTok requires rewriting 4+ services. | Architectural lock-in to Meta. | **Medium** — interface extraction |
| P0-3 | **`platform: 'facebook'` hardcoded in `addFunding()`** — Funding entries always tagged as Facebook regardless of actual platform. | Incorrect financial records. | **Trivial** — 1-line fix |
| P0-4 | **`allocatedCurrency: 'USD'` hardcoded** — Cost allocations always written as USD regardless of ad account currency. | Misleading allocation records. | **Small** — read from AdAccount.currency |
| P0-5 | **Cash-basis journal entries only** — P&L recognizes marketing expense at deposit, not at spend/allocation time. | P&L timing mismatch. | **Medium** — add consumption/allocation journal entries |

### P1 — Architectural Correctness (SHOULD FIX)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| P1-1 | **No configurable attribution window** — matches all sessions regardless of time gap. | Over-attribution risk. | **Small** — add setting + WHERE clause |
| P1-2 | **`fbclid` in `OrderAttributionMethod` enum** — Meta-specific term in core domain. | Naming leak. | **Trivial** — rename to `click_id` |
| P1-3 | **Graph API version hardcoded `v21.0`** — spec requires configurable version. | Cannot upgrade Meta API without code change. | **Trivial** — read from settings |
| P1-4 | **No event-driven architecture** — spec Part 7 mandates domain events. Services call each other directly. | Tight coupling. | **Large** — event bus implementation |
| P1-5 | **No dirty tracking tables** — spec Part 3 requires dirty tracking for incremental recalculation. | Full recalculation on every change. | **Medium** — new table + tracking logic |
| P1-6 | **No integration tests** — all 111 tests mock Prisma. Real database behavior untested. | SQL/transaction bugs undetected. | **Medium** — test database setup |
| P1-7 | **No frontend tests** — 12 marketing UI components, zero tests. | UI regressions undetected. | **Medium** — component tests |

### P2 — Business Intelligence Improvement (STRONGLY RECOMMENDED)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| P2-1 | **Campaign list shows zero financial columns** — no Spend, Revenue, ROAS, Profit. | Business owner cannot assess campaign profitability. | **Medium** — API already has data |
| P2-2 | **No break-even CPA comparison** — "My product can tolerate up to ৳X per purchase" | No actionable cost threshold. | **Small** — calculation + UI |
| P2-3 | **No campaign scorecard with automatic verdict** — green/yellow/red per campaign | Owner must manually compute profitability. | **Small** — badge computation |
| P2-4 | **No "Am I profitable?" headline indicator** — top of dashboard | Key question unanswered at a glance. | **Small** — new KPI card |
| P2-5 | **Intelligence CAC/CPP lack benchmark context** — raw numbers with no good/bad indicator | Numbers meaningless without context. | **Small** — configurable benchmarks |
| P2-6 | **No per-campaign product breakdown** — campaign detail shows no product-level data | Cannot identify which products drive campaign profit. | **Medium** — new query + UI |

### P3 — UX Enhancement (USEFUL BUT NOT BLOCKING)

| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| P3-1 | **No sort on campaign/product tables** | Cannot quickly find worst/best performers. | **Small** |
| P3-2 | **Attribution page too technical** — shows `fbclid`, confidence %, method names | Non-technical users confused. | **Small** |
| P3-3 | **Campaign detail has no tabs** — everything on one scroll | No drill-down structure. | **Medium** |
| P3-4 | **No export/report generation** | Cannot share reports with accountant. | **Medium** |
| P3-5 | **ROI trend chart lacks axis labels** | Cannot read exact values. | **Small** |
| P3-6 | **Spend Snapshots missing margin %** | Only shows profit, not margin. | **Trivial** |
| P3-7 | **Connection token expiry not shown** | Owner unaware when token expires. | **Small** |
| P3-8 | **Funding form is accountancy-heavy** | Non-accountant users confused by "effective rate" / "base amount". | **Medium** |

### P4 — Future Roadmap (DO NOT IMPLEMENT NOW)

| # | Finding |
|---|---------|
| P4-1 | Multi-touch attribution (first, linear, time decay) |
| P4-2 | Manual attribution assignment UI |
| P4-3 | Budget pacing and forecasting |
| P4-4 | Cohort/LTV analysis |
| P4-5 | "What-if" simulator |
| P4-6 | Campaign comparison view |
| P4-7 | Automated weekly email summary |
| P4-8 | CompanyMarketingSummary table |
| P4-9 | OrderProfitSnapshot table |
| P4-10 | Configurable historical import range (30/90/180 days) |

---

## 15. CHANGES MADE DURING AUDIT

| Change | Files | Reason |
|--------|-------|--------|
| Help page created | `features/marketing/help.tsx`, route file, sidebar entry | Business tutorial requirement |
| Token guide added | `features/marketing/help.tsx` expandable section | Access token step-by-step guide |
| Route component wiring fixed | 10 route files (added `{ component: ... }`) | All marketing pages were blank |

---

## 16. REMAINING DECISIONS

### Business Owner Decisions Required:

1. **Accounting model depth** — Do you need the 5-layer model (spend/billing/tax/payment/cost), or is the current 2-layer model (funding + consumption) sufficient for your business?

2. **Provider abstraction priority** — Should we refactor for TikTok readiness NOW (add 1-2 weeks), or accept the Meta lock-in and refactor when TikTok is actually needed?

3. **Accrual vs cash-basis accounting** — Should marketing expense be recognized when money is deposited (current) or when ads actually run (spec-compliant)?

4. **Dashboard financial columns** — The campaign list currently shows no financial data. Should we add Spend/Revenue/ROAS/Profit columns before production launch?

5. **Break-even CPA** — Should we implement a break-even CPA calculator that shows "Your product can tolerate up to ৳X per purchase"?

6. **Tax/fee decomposition** — Do you track platform fees, VAT, or processing fees separately from FX conversion? If yes, we need the full tax model. If no, the current `effectiveRate` approach is sufficient.

---

## 17. DESIGN PRINCIPLE COMPLIANCE

> **Complexity belongs inside the system; simplicity belongs on the business dashboard.**

| Level | Current Status |
|-------|---------------|
| Level 1 — Decision ("Is this campaign making money?") | **FAIL** — Campaign list shows no financial data |
| Level 2 — Explanation ("Why?") | **PARTIAL** — `explainProfit` exists in API but buried |
| Level 3 — Detail (spend/billing/tax/FX/attribution) | **PARTIAL** — Available in backend, not all surfaced in UI |

The internal complexity (FIFO, allocation, attribution, journal entries) is correctly implemented. The external simplicity (business dashboard) is the primary gap.

---

**End of Forensic Audit Report**
