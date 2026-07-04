# Product Catalog Feed Generator Implementation Plan

**Goal:** Build a secure, streaming Product Catalog Feed Generator for Meta, Google, and TikTok platforms with license-gated access.

**Architecture:** New `feed` NestJS module with cursor-paginated XML streaming + GZIP compression. Admin UI under new "Marketing" sidebar. Next.js storefront route for clean redirect. License-gated via `@RequiresFeature('admin_product_feeds')`.

**Tech Stack:** NestJS + Prisma + zlib (streaming GZIP) + TanStack Router + Zustand

**Key decisions:**
- Variants → separate `<item>` with shared `item_group_id` (Google/Meta standard)
- BDT currency (configurable later)
- On-demand streaming (no cron/S3 for now)
- Feature flag key: `admin_product_feeds`
- Admin UI: new "Marketing" collapsible in Operational sidebar

---

### Task 1: Prisma — Add ProductFeedConfig + ProductFeedLog models

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

Add after `model LicenseActivation` (around line 1616):

```prisma
model ProductFeedConfig {
  id                String    @id @default(uuid())
  tenantId          String
  platform          String    // meta, google, tiktok
  secureToken       String    @unique
  isActive          Boolean   @default(true)
  excludeOutOfStock Boolean   @default(false)
  minPriceFilter    Decimal?  @db.Decimal(10, 2)
  lastFetchedAt     DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([tenantId])
  @@index([secureToken, isActive])
}

model ProductFeedLog {
  id         String   @id @default(uuid())
  tenantId   String
  platform   String
  ipAddress  String
  userAgent  String
  statusCode Int
  durationMs Int
  fetchedAt  DateTime @default(now())

  @@index([tenantId])
  @@index([fetchedAt])
}
```

Also update `model LicenseActivation` — it already has `licenseInfo Json? @db.JsonB` which contains the `features` array. No TenantLicense model needed.

Run: `npx prisma migrate dev --name add_product_feed_models` then `npx prisma validate && npx prisma generate`

**Commit:**
```
git add apps/backend/prisma/
git commit -m "feat(feed): add ProductFeedConfig and ProductFeedLog models"
```

---

### Task 2: Backend — Feed module (service)

**Files:**
- Create: `apps/backend/src/feed/feed.service.ts`
- Create: `apps/backend/src/feed/feed.controller.ts`
- Create: `apps/backend/src/feed/feed.module.ts`
- Modify: `apps/backend/src/app.module.ts`

**feed.service.ts** — Core logic:
- `validateToken(token: string, platform: string)` — validate config exists + isActive + license includes `admin_product_feeds`
- `generateMetaXml(token: string, reply: any)` — stream XML with cursor pagination
- `generateGoogleXml(token: string, reply: any)` — Google-specific XML (similar but Google namespace)
- `generateTikTokXml(token: string, reply: any)` — TikTok CSV/TSV or XML
- `mapToXmlNode(product, config)` — escape + format single product XML node
- `logAccess(tenantId, platform, ip, ua, statusCode, durationMs)` — insert log
- Use `zlib.createGzip()` for compression
- Use cursor pagination (chunkSize: 250, orderBy: { id: 'asc' })
- XML escaping: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`
- Variable products: parent product → `<g:item_group_id>` set to product ID; each variant → separate `<item>`

**feed.controller.ts:**
- `@Get('v1/feeds/catalog/:token/:platform')` — public endpoint (no JWT), validate token + license, stream feed
- `@Roles('admin', 'superadmin') @RequiresFeature('admin_product_feeds') @Post('v1/feeds/config')` — create/update config
- `@Roles('admin', 'superadmin') @RequiresFeature('admin_product_feeds') @Get('v1/feeds/config')` — list configs
- `@Roles('admin', 'superadmin') @RequiresFeature('admin_product_feeds') @Post('v1/feeds/config/:id/regenerate-token')` — rotate token
- `@Roles('admin', 'superadmin') @RequiresFeature('admin_product_feeds') @Get('v1/feeds/logs')` — view access logs

Product data included in feed:
- `id` (sku or product ID), `title` (name), `description` (shortDesc or description), `link` (product URL), `image_link`, `availability`, `price` (BDT), `sale_price`, `brand`, `condition` (new), `item_group_id` (for variants)

**Registration:** Add `FeedModule` to `app.module.ts` imports.

**Commit:**
```
git add apps/backend/src/feed/ apps/backend/src/app.module.ts
git commit -m "feat(feed): add feed module with XML streaming endpoints"
```

---

### Task 3: Backend — Feed module seed + tests

**Files:**
- Create: `apps/backend/src/feed/feed.service.spec.ts`

Test cases:
- `validateToken` — valid config, invalid token, inactive config, unlicensed
- `generateMetaXml` — empty catalog, products with/without variants, XML structure
- `mapToXmlNode` — field escaping, variant grouping

Run: `npx jest src/feed/feed.service.spec.ts --no-coverage`
Expected: All tests pass

**Commit:**
```
git add apps/backend/src/feed/feed.service.spec.ts
git commit -m "test(feed): unit tests for feed service"
```

---

### Task 4: Admin frontend — License store + sidebar + feed page

**Files:**
- Create: `apps/admin/src/stores/license-store.ts` — Zustand store for license features
- Modify: `apps/admin/src/components/layout/authenticated-layout.tsx` — populate license store
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts` — add Marketing collapsible with Campaigns + Product Catalogs
- Create: `apps/admin/src/features/product-feeds/index.tsx` — Feeds page
- Create: `apps/admin/src/features/product-feeds/api.ts` — API service
- Create: `apps/admin/src/features/product-feeds/hooks.ts` — TanStack Query hooks
- Create: `apps/admin/src/routes/_authenticated/op/product-feeds/index.tsx` — route

**license-store.ts:**
```typescript
import { create } from 'zustand'
import { apiClient } from '@/lib/api-client'

interface LicenseStore {
  features: string[]
  loaded: boolean
  fetchFeatures: () => Promise<void>
  hasFeature: (key: string) => boolean
}
```

**sidebar-data.ts changes:**
- Change standalone `Campaigns` item into collapsible "Marketing" group
- Inside: Product Catalogs, Campaigns

**authenticated-layout.tsx changes:**
- After `/license/status` fetch, call `useLicenseStore.getState().setFeatures(r.data.license?.features || [])`

**Product Catalogs page:**
- Shows table of configured feeds (Meta, Google, TikTok)
- Per platform: active toggle, token (masked) with copy + regenerate, exclude OOS toggle, last fetch time
- "Create Feed" button if not configured

**Route:** `_authenticated/op/product-feeds/index.tsx`

Run: `npx tsc --noEmit` in `apps/admin` — no errors expected

**Commit:**
```
git add apps/admin/src/
git commit -m "feat(feed): admin UI for product feed management"
```

---

### Task 5: Storefront — API route handler

**Files:**
- Create: `apps/storefront/app/catalog/v1/[token]/[platform]/route.ts`

Next.js route handler that 302-redirects to backend:

```typescript
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: { token: string; platform: string } },
) {
  const backendUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/feeds/catalog/${params.token}/${params.platform}`
  return NextResponse.redirect(backendUrl, 302)
}
```

Run: `npx tsc --noEmit` in `apps/storefront` — no errors expected

**Commit:**
```
git add apps/storefront/app/catalog/
git commit -m "feat(feed): storefront route handler for feed redirect"
```

---

### Task 6: Verification

- Backend build: `npx nest build`
- Backend tests: `npx jest src/feed/feed.service.spec.ts --no-coverage`
- Admin tsc: `npx tsc --noEmit`
- Storefront tsc: `npx tsc --noEmit`
- Prisma: `npx prisma validate`
- All pass
