# Phase 9: Claim Verification Report

> **Status:** Complete  
> **Method:** Cross-referenced every unverified doc claim against backend src, Prisma schema, frontend components, Docker config, and package manifests

---

## Claim 1: License Engine — C++ N-API Addon

**Claim (README.md):** "C++ N-API addon (node-gyp) for license validation. Ed25519 signature verification."

**Reality:** 🔴 **FALSE**

| Detail | Claim | Actual |
|--------|-------|--------|
| Crypto algorithm | Ed25519 | HMAC-SHA256 |
| Language | C++ N-API | Pure TypeScript |
| Native addon | `.node` binary | **Does not exist** |
| `binding.gyp` | Present | **Does not exist** |
| C++ source files | `addon.cc`, `validator.cc` | **Do not exist** |
| `VerifyEd25519` function | Exists | **Does not exist** |
| Offline verification | Crypto signature | HMAC via `createHmac('sha256', secret)` — real but skips crypto if no secret provided |

**Root cause:** C++ addon was planned but never implemented. `index.js` (root) references nonexistent native addon and would crash at runtime. The actual entry point is `dist/index.js` (compiled TypeScript), which correctly uses HMAC-SHA256.

**Verdict:** Documentation claims are inaccurate. Update README.md.

---

## Claim 2: Obfuscation — Production Backend Only

**Claim (README.md):** "JS obfuscation applied to backend production builds only."

**Reality:** ✅ **VERIFIED TRUE**

| Check | Finding |
|-------|---------|
| Obfuscator installed globally | `npm install -g javascript-obfuscator@^4.1.1` in Dockerfile |
| Config file | `apps/backend/obfuscator.config.json` — real config |
| Control flow flattening | True (threshold 0.75) |
| String encoding | base64 with 0.8 threshold |
| Dead code injection | True (threshold 0.4) |
| Self-defending | True |
| Docker build stage | Dedicated `obfuscator` stage between `builder` and `runner` |
| Always active | No toggle — unconditional |

---

## Claim 3: License Feature Gating — 68 Features

**Claim (final-feature-plan.md):** "68 features gated by license. Each has UI hiding, URL protection, error messages."

**Reality:** 🟡 **PARTIALLY IMPLEMENTED — SIGNIFICANT GAPS**

| Metric | Count |
|--------|-------|
| Features defined in `FEATURES` constant | 68 |
| Unique feature names in `@RequiresFeature()` | 41 (of which 11 are orphan keys) |
| Feature-plan features actually wired to controllers | **30** |
| Feature-plan features with NO controller guard | **38** |
| Orphan feature keys (in code, not in plan) | 11 |
| Controllers with `@RequiresFeature` | 50/68 |
| Controllers WITHOUT `@RequiresFeature` | **18** |

**Missing guards on critical endpoints:**
- `dispatch` — no feature gate
- `packing` — no feature gate
- `warehouses` — no feature gate
- `pos` (orders + sessions) — no feature gate
- `courier-webhook` — no feature gate
- `bkash-pgw` — no feature gate
- `images` — no feature gate
- `tracking` — no feature gate
- `delivery-areas` — no feature gate
- `designations` — no feature gate
- `license` — no feature gate (intentional)
- `health` — no feature gate (intentional)
- `auth`, `auth-settings` — no feature gate (intentional)
- `settings` — no feature gate
- `security` — no feature gate

---

## Claim 4: Storefront Data Fetching

**Claim (AGENTS.md):** "Dual pattern: serverFetch() for reads, axios for client mutations. Server Components preferred, Client Components minimized. React Query acceptable mainly for client interactivity."

**Reality:** 🟡 **MOSTLY TRUE — ONE FALSE CLAIM**

| Sub-claim | Verdict | Detail |
|-----------|---------|--------|
| "serverFetch() for reads" | ✅ True | 18 call sites, all server-side reads |
| "axios for client mutations" | 🟡 Partially True | Axios used for mutations AND client reads |
| "Server Components preferred" | ✅ True | 22/27 pages are Server Components |
| "Client Components minimized" | 🟡 Partially | 52 client components is not aggressively minimal |
| "React Query acceptable" | 🔴 **FALSE** | **React Query is not used anywhere in storefront** — uses raw axios + useEffect + custom hooks |

**Additional verified claims:**
- ISR heavily utilized: ✅ (`revalidate: 60` on products, `300` on detail pages)
- `generateMetadata`: ✅ (product detail, landing pages)
- `generateStaticParams`: ✅ (pre-builds up to 100 products)

---

## Claim 5: StockService — Single Gateway

**Claim (README.md, ADR-003):** "StockService is the single gateway for all stock operations."

**Reality:** 🔴 **FALSE — 4 VIOLATIONS FOUND**

| Violation | Location | Impact |
|-----------|----------|--------|
| OrdersService.deductStockForOrder() — direct Prisma update on `managedStockQuantity` | `orders.service.ts:1734-1755` | Bypasses StockService entirely |
| OrdersService.handleReturnedSideEffects() — direct Prisma update | `orders.service.ts:1639-1660` | Bypasses StockService |
| OrdersService.restoreStockForCancelledOrder() — direct updates | `orders.service.ts:1789-1810` | Bypasses StockService |
| InventoryService.adjust() — direct Prisma updates on variants/products | `inventory.service.ts:249-411` | Bypasses StockService |
| StockService.operate() writes to InventoryLog, not ManagedStockLedger | `stock.service.ts:258` | Dual-tracking drift |

---

## Claim 6: Dual Auth System

**Claim (README.md, ADR-001):** "Dual auth — legacy JWT + Better Auth"

**Reality:** ✅ **VERIFIED TRUE**

| Component | Finding |
|-----------|---------|
| `DualModeAuthGuard` | ✅ Registered as global APP_GUARD |
| Legacy JWT | ✅ Passport JWT strategy active |
| Better Auth | ✅ Session-based auth, tables in schema |
| Auto-provisioning | ✅ Better Auth user auto-provisioned on first login |
| Admin client | `admin/src/lib/better-auth-client.ts` |
| Storefront client | `storefront/lib/better-auth-client.ts` |
| POS client | `pos/src/lib/better-auth-client.ts` |

---

## Claim 7: Dual Stock Tracking

**Claim (ADR-003):** "ManagedStockLedger is authoritative. InventoryLog deprecated."

**Reality:** 🟡 **PARTIALLY IMPLEMENTED — MIGRATION INCOMPLETE**

- New ManagedStockLedger writes: ✅ orders.service.ts `deductStockForOrder()`, inventory.service.ts `adjust()`
- New InventoryLog writes (should be deprecated): 🔴 stock.service.ts `operate()`, inventory.service.ts `restockOrderItems()`, inventory.service.ts `transferStock()`
- Direct stock mutations (no ledger at all): 🔴 orders.service.ts

---

## Claim 8: Per-Client Deployment

**Claim (ADR-004):** "Each client gets its own Docker stack."

**Reality:** ✅ **TEMPLATE EXISTS — DEPLOYMENT NOT TESTED**

- `clients/client-example/` template exists with config
- `.github/workflows/deploy-client.yml` workflow exists
- Deployment to real infrastructure not verified (out of scope for code audit)

---

## Claim 9: Architecture NFRs

**Claim** | **Reality** | **Verdict**
----------|-------------|-----------
"NestJS + Fastify" | `NestFastifyApplication` in main.ts | ✅ Verified
"Prisma 7.9.1" | In package.json | ✅ Verified
"PostgreSQL" | Prisma provider configured | ✅ Verified
"Redis + BullMQ" | QueueModule, Redis env var | ✅ Verified
"Obfuscation on backend production" | Docker obfuscator stage | ✅ Verified
"7-day local license cache" | (Not yet checked — need to verify cache TTL in LicenseService/LicenseEngine) | 🟡 Unverified

---

## Claim 10: Admin UI Claims

**Claim** | **Reality** | **Verdict**
----------|-------------|-----------
"Shadcn UI" | Yes, `components.json`, shadcn imports | ✅ Verified
"TanStack Query for data fetching" | Yes, `@tanstack/react-query` in package.json | ✅ Verified

---

## Updated Implementation Status Matrix

| Feature | Previous Status | Phase 9 Verdict |
|---------|----------------|----------------|
| License Engine (C++ N-API) | Implemented (Unverified) | 🔴 **Documentation Bug — no C++ code exists** |
| Obfuscation | Implemented (Unverified) | ✅ **Verified — fully active** |
| Feature Gating (68 features) | Implemented (Unverified) | 🟡 **Partial — only 30/68 features wired** |
| Storefront Patterns | Implemented (Unverified) | 🟡 **Mostly correct — React Q claim false** |
| StockService Single Gateway | Claimed | 🔴 **False — 4 violations found** |
| Dual Auth | Implemented (Unverified) | ✅ **Verified** |
| Dual Stock Ledger | Implemented (Unverified) | 🟡 **Migration incomplete** |
| Per-Client Deployment | Implemented (Unverified) | ✅ **Template exists** |

## SoT Priority Violations

| Priority | Document | Contradiction | Action |
|----------|----------|---------------|--------|
| Documentation | README.md | Claims C++ N-API addon — actual is pure TS HMAC | Rewrite claim |
| Documentation | AGENTS.md (storefront) | Claims React Query — not used | Remove claim |
| Architecture | ADR-003 (StockService as gateway) | Code violates this in 4 places | Phase 10 fix |
| Business Domain | Domain Contract (StockService only gateway) | Code violates | Phase 10 fix |

## Next Phase: 10 — Normalization

Code changes to align implementation with settled documentation. Fixes prioritized by severity.

**Proceed to Phase 10?**