# Product Catalog Feed — Gap Analysis & Consolidation Design

**Date:** 2026-07-19
**Status:** Draft for review

---

## Part 1: Current State Analysis

### 1.1 Architecture Overview

```
Frontend (Admin)                    Backend (NestJS)                Storefront (Next.js)
─────────────────                   ────────────────                ────────────────────
OP Panel                            FeedModule                      ❌ No route for
  /op/product-feeds                   /v1/feeds/catalog/:token/:platform   catalog feeds
  → features/product-feeds/           /v1/feeds/config
  (165 lines)                         /v1/feeds/config/:id
                                      /v1/feeds/config/:id/regenerate-token
MON Panel                             /v1/feeds/logs
  /mon/marketing/catalog
  → features/feeds/
  (223 lines)
```

### 1.2 Duplicate Implementations

| Aspect | OP Panel | MON Panel |
|--------|----------|-----------|
| Component | `features/product-feeds/index.tsx` | `features/feeds/index.tsx` |
| API layer | `features/product-feeds/api.ts` | `features/feeds/api.ts` |
| Hooks | `features/product-feeds/hooks.ts` | Inline in component |
| Create feed | ✅ Yes | ❌ No |
| Min price filter | ❌ No | ✅ Yes |
| Access logs | ❌ Hook exists, unused | ✅ Expandable table |
| Toast feedback | ❌ None | ✅ sonner |
| Token visibility | ✅ Eye toggle | ❌ Always visible |
| Empty state | "Not configured" + Create btn | "Run DB seed" — no action |
| License check | Component-level (message) | Route-level (silent null) |

### 1.3 Critical Issues Found

#### CRIT-1: Feed URL Wrong in OP Panel
- **OP:** `{STOREFRONT_URL}/catalog/v1/{token}/{platform}`
- **Backend:** `GET /v1/feeds/catalog/:token/:platform`
- Path mismatch: `/catalog/v1/` vs `/v1/feeds/catalog/`
- Storefront has **no route** for catalog feeds — OP "Open" link returns 404

#### CRIT-2: `categoriesFilter` — Dead Code/Ghost Field
- Exists in `features/feeds/api.ts` interface only
- Not in Prisma schema, DTO, service, or UI
- Misleading type definition

#### CRIT-3: All Access Logs Record `0.0.0.0` IP
```typescript
// feed.service.ts:247
ipAddress: '0.0.0.0',  // Hardcoded — real IP never captured
userAgent: 'feed-generator',
```
- `@Res()` used in controller but request metadata not passed to service

#### CRIT-4: Marketing Feature Flag Dependency
- OP Product Catalogs nested under Marketing (`admin_email_campaigns`)
- Parent flag blocks child even if `admin_product_feeds` is licensed

---

### 1.4 Backend Gaps

#### Google Shopping XML — Missing Required Fields

| Field | Status | Priority |
|-------|--------|----------|
| `g:google_product_category` | ❌ | **HIGH** — Required by Google |
| `g:product_type` | ❌ | HIGH |
| `g:gtin` / `g:mpn` / `g:identifier_exists` | ❌ | **HIGH** — Required for new items |
| `g:shipping` | ❌ | MEDIUM |
| `g:tax` | ❌ | MEDIUM |
| `g:additional_image_link` | ❌ | MEDIUM |
| `g:currency` | ❌ | LOW — Only BDT hardcoded |
| `g:sale_price_effective_date` | ❌ | LOW |

#### Missing Backend Features

| Feature | Gap |
|---------|-----|
| Category filter | Not in Prisma schema, DTO, or service |
| Brand filter | Not supported |
| Price range (min+max) | Only minPriceFilter |
| Redis/application cache | None — each request is DB-heavy |
| Rate limiting | Public endpoint unprotected |
| Manual refresh trigger | No endpoint to regenerate without fetch |
| CDN integration | No cache layer |
| Multi-tenant isolation | `tenantId: 'default'` hardcoded, no tenant filter |
| Feed validation | No XML validation before serving |
| Platform-specific templates | All 3 platforms use same Google Shopping XML |

#### Feed Content Quality Issues

| Issue | Detail |
|-------|--------|
| `managedStockQuantity` | Checks stock even with `manageStock: false` |
| No full image URL | `images[0]` may be relative path |
| Variant title | `{parentName} - {variantSku}` — not ideal for shopping |
| `g:condition` | Always `new` — no used/refurbished support |

---

### 1.5 Frontend UI/UX Gaps

| Issue | OP | MON | Impact |
|-------|----|-----|--------|
| Per-action loading | ❌ | ❌ | Double-click risk |
| Mutation error handling | ❌ | ❌ | Silent failures |
| Optimistic updates | ❌ | ❌ | Stale UI |
| Confirmation on token regen | ❌ | ❌ | Breaks integrations |
| Create feed from UI | ✅ | ❌ | Can't add new platform |
| Access logs | ❌ | ✅ | Missing monitoring |
| Toast notifications | ❌ | ✅ | Silent feedback |
| Responsive layout | ✅ Grid | ⚠️ Stack | OK for both |
| Keyboard accessibility | ⚠️ Basic | ⚠️ Basic | a11y gaps |

---

## Part 2: Consolidation Design

### 2.1 Decision: MON Panel Only

**Why MON:**
- Product Catalog Feeds = configure-once, monitor-always feature
- Marketing module not yet built; moving under it later is easier from MON
- MON already has the more complete implementation (logs, min price)
- Eliminates confusion and duplication

### 2.2 Proposed Architecture

```
MON Panel (single source of truth)
  /mon/marketing/catalog
  → features/feeds/ (consolidated)

Changes:
  1. Remove features/product-feeds/ (OP version)
  2. Remove route apps/admin/src/routes/_authenticated/op/product-feeds/
  3. Enhance features/feeds/ with missing OP features (create, token toggle)
  4. Remove OP sidebar entry
  5. Fix sidebar icon to consistent icon
  6. Fix feed URL construction (use API_ORIGIN, correct path)
```

### 2.3 Frontend — Consolidated Component Requirements

The single `FeedsPage` should include:

- [ ] Create feed per platform (from OP)
- [ ] Token show/hide toggle (from OP)
- [ ] Copy full URL button (from MON) + Copy token only (from OP)
- [ ] Min price filter (from MON)
- [ ] Exclude OOS checkbox (both)
- [ ] Active toggle switch (both)
- [ ] Expandable access logs (from MON)
- [ ] Last fetched timestamp (both)
- [ ] Regenerate token with confirmation dialog (new)
- [ ] Toast notifications on all mutations (from MON)
- [ ] Error handling on all mutations (new)
- [ ] Platform-colored badges (from MON)
- [ ] Consistent empty state with Create action
- [ ] Loading states per action

### 2.4 Backend — Required Fixes

Priority order:

1. **Fix IP logging** — Pass IP + User-Agent from request to `logAccess()`
2. **Add rate limiting** — Apply `@Throttle()` to public feed endpoint
3. **Add `categoriesFilter` to Prisma** — Or remove from interface
4. **Add `g:google_product_category` to feed XML** — From product category tree
5. **Add `g:gtin`/`g:mpn`** — If product has these fields
6. **Add Redis cache** — Cache rendered XML per token+platform
7. **Add manual refresh endpoint** — `POST /v1/feeds/catalog/:token/:platform/refresh`
8. **Fix multi-tenant** — Use real tenantId from auth context
9. **Add brand/tag filtering support** — Expand DTO
10. **Fix stock check** — Respect `manageStock` flag

### 2.5 Feed XML — Enhanced Template

```
<item>
  <g:id>{sku}</g:id>
  <g:title>{product.name}</g:title>
  <g:description>{clean description}</g:description>
  <g:link>{storefront_url}/product/{slug}</g:link>
  <g:image_link>{full_url}</g:image_link>
  <g:additional_image_link>{image2},{image3}</g:additional_image_link>  <!-- NEW -->
  <g:availability>{in_stock|out_of_stock}</g:availability>
  <g:price>{price} BDT</g:price>
  <g:sale_price>{sale_price} BDT</g:sale_price>
  <g:brand>{brand}</g:brand>
  <g:condition>new</g:condition>
  <g:google_product_category>{category_id}</g:google_product_category>  <!-- NEW -->
  <g:product_type>{category_path}</g:product_type>                       <!-- NEW -->
  <g:item_group_id>{parent_id}</g:item_group_id>
  <g:identifier_exists>FALSE</g:identifier_exists>                       <!-- NEW -->
</item>
```

### 2.5 Fix: Stock Logic — Feed Must Match Storefront

#### Current (Broken) — `feed.service.ts`

```typescript
// Line 140 — variant
availability: variant.managedStockQuantity > 0 ? 'in stock' : 'out of stock',

// Line 164 — simple product
availability: product.managedStockQuantity > 0 ? 'in stock' : 'out of stock',

// Line 203 — OOS filter
filter.managedStockQuantity = { gt: 0 };
```

**Problems:**
- Ignores `availabilityMode` (ALWAYS_IN_STOCK, ALWAYS_OUT_OF_STOCK, INVENTORY_CONTROLLED)
- Ignores `manageStock` boolean flag
- Ignores `reservedStock` — shows stock that's already reserved as available
- Ignores `PhysicalInventory` table (INVENTORY_CONTROLLED mode)

#### Required — Must Match `products.service.ts` Logic

Use the same `availableStock` computation as the storefront API (`products.service.ts:1159-1166`):

```
availabilityMode:
  ALWAYS_IN_STOCK    → availableStock = null (always in stock)
  ALWAYS_OUT_OF_STOCK → availableStock = 0 (always out of stock)
  MANAGED_STOCK      → availableStock = managedStockQuantity - reservedStock
  INVENTORY_CONTROLLED → availableStock = PhysicalInventory.quantity - reservedQuantity
```

For variable products: aggregate variant stock (same as storefront).

For `excludeOutOfStock` filter: `availableStock <= 0 || availabilityMode === 'ALWAYS_OUT_OF_STOCK'`

#### g:availability Mapping

| availableStock | Feed XML |
|----------------|----------|
| `null` (ALWAYS_IN_STOCK) | `in stock` |
| `> 0` | `in stock` |
| `<= 0` | `out of stock` |
| `ALWAYS_OUT_OF_STOCK` | `out of stock` |

**No quantity sent in feed** — Google/Meta/TikTok feeds use status only (`in stock`, `out of stock`, `preorder`). Quantity is not a standard XML field.

### 2.6 Migration Path

| Step | Action | Files |
|------|--------|-------|
| 1 | Fix backend CRIT issues | `feed.service.ts`, `feed.controller.ts` |
| 2 | Enhance Prisma schema | Add `categoriesFilter`, `gtin`, `mpn` fields |
| 3 | Run migration | `prisma migrate dev` |
| 4 | Consolidate frontend | Merge features, remove OP duplicate |
| 5 | Fix sidebar | Remove OP entry, update MON icon |
| 6 | Add missing UI features | Create, confirmation, loading, error |
| 7 | Update feed URL | Use correct path pointing to backend |
| 8 | TypeScript check | `npx tsc --noEmit` |
| 9 | Backend build | `npx nest build` |
| 10 | Verify | Manual + existing test `feed.service.spec.ts` |

---

## Appendix: File Changes Summary

### Remove (4 files)
- `apps/admin/src/features/product-feeds/` (entire directory)
- `apps/admin/src/routes/_authenticated/op/product-feeds/index.tsx`

### Modify (5 files)
- `apps/admin/src/features/feeds/index.tsx` — add create, token toggle, confirmation, loading states, error handling
- `apps/admin/src/features/feeds/api.ts` — add create method, fix response handling, remove `categoriesFilter` from interface until backend supports it
- `apps/admin/src/components/layout/data/sidebar-data.ts` — remove OP entry, update MON icon
- `apps/backend/src/feed/feed.service.ts` — fix IP logging, add rate limit, enhance XML
- `apps/backend/src/feed/feed.controller.ts` — pass request metadata, add refresh endpoint

### Schema (1 file)
- `apps/backend/prisma/schema.prisma` — add categoriesFilter, gtin, mpn to ProductFeedConfig
