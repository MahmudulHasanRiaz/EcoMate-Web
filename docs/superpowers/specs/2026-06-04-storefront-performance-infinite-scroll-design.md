# Super-Fast Storefront + Smart Infinite Scroll — Design Spec

**Date:** 2026-06-04
**Status:** Approved
**Scope:** Catalog pages (products, combos) and image optimization

## Goals

1. **Server-render the first page** of product/combo listings (RSC + ISR) so users see
   products immediately without waiting for client-side JS.
2. **Replace naive page-number pagination** with **smart cursor-based infinite scroll** on
   the client island beyond page 1.
3. **Convert all product/combo images to `next/image`** with proper `sizes`, `priority`,
   `fetchPriority`, and explicit dimensions to eliminate CLS and improve LCP.
4. **Preserve deep-linking and back-button** with URL cursor sync.
5. **Mobile-first performance** targeting sub-2.5s LCP on slow 3G.

## Out of scope

- Admin order/inventory pagination (separate UX; not the storefront customer experience)
- Search results page (uses same `ArchivePageClient` pattern; will share the hook)
- Combo detail page (single-item page, not a grid)

## Backend changes

### Cursor-based pagination

`GET /products` and `GET /combos` accept either `cursor` (preferred) or legacy `page`:

```ts
// query: { cursor?: string; perPage?: number; ...filters }
// response.meta: { nextCursor: string | null; hasMore: boolean; total: number; perPage: number }
```

Cursor format: base64url(`${createdAt.toISOString()}|${id}`) — opaque to client.
Stable order: `ORDER BY createdAt DESC, id DESC` (deterministic tiebreak).

Default `perPage: 24` for products, `12` for combos (was unspecified in many places).

### Files
- `apps/backend/src/products/products.service.ts` — add `findAllCursor()`
- `apps/backend/src/products/products.controller.ts` — accept `cursor` query
- `apps/backend/src/combos/combos.service.ts` — same
- `apps/backend/src/combos/combos.controller.ts` — same
- Response shape: keep `data: T[]`, extend `meta` with `nextCursor` and `hasMore`; keep
  `page`/`totalPages` for backward compat (derive from cursor if absent)

## Storefront changes

### Server Component shell

```tsx
// app/products/page.tsx  (Server Component, dynamic = 'force-dynamic' per AGENTS.md)
import { fetchProductsServer } from '@/lib/api/products-server';
import { ArchiveGridClient } from './ArchiveGridClient';

export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const { data, meta } = await fetchProductsServer({ perPage: 24, ...sp });
  return (
    <ArchiveGridClient
      initialItems={data}
      initialCursor={meta.nextCursor}
      initialHasMore={meta.hasMore}
      filters={sp}
    />
  );
}
```

### Client island (thin)

```tsx
// app/products/ArchivePageClient.tsx  ("use client")
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';

export function ArchiveGridClient({ initialItems, initialCursor, initialHasMore, filters }) {
  const { items, isLoading, hasMore, sentinelRef, error, retry } = useInfiniteScroll({
    initialItems, initialCursor, initialHasMore,
    fetchPage: (cursor, signal) => fetchProducts({ ...filters, cursor, signal }).then(r => r.meta),
    getId: (p) => p.id,
  });
  // render grid + sentinel
}
```

### `useInfiniteScroll` hook

```ts
// apps/storefront/lib/hooks/useInfiniteScroll.ts
interface UseInfiniteScrollOpts<T> {
  initialItems: T[];
  initialCursor: string | null;
  initialHasMore: boolean;
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<{
    items: T[]; nextCursor: string | null; hasMore: boolean;
  }>;
  getId: (item: T) => string;
  pageSize?: number;            // for skeleton count
}

interface UseInfiniteScrollResult<T> {
  items: T[];
  isLoading: boolean;
  hasMore: boolean;
  error: Error | null;
  sentinelRef: (node: HTMLElement | null) => void;
  retry: () => void;
}
```

**Smart behaviors (all required):**

| # | Feature | Implementation |
|---|---------|----------------|
| 1 | Sentinel-based trigger | `IntersectionObserver` with `rootMargin: '200px 0px'` |
| 2 | Dedup | `Set<string>` of seen IDs; never append item with seen ID |
| 3 | Abort | `AbortController` per request; cancel previous if new fetch starts |
| 4 | URL sync | `history.replaceState` with `?after={cursor}` on each load |
| 5 | Visibility pause | `document.visibilitychange` listener skips fetch when hidden |
| 6 | End state | When `hasMore === false`, hide sentinel, show end marker |
| 7 | Retry | On error, keep last cursor, show "Retry" button, auto-retry on next intersection |
| 8 | First-N eager | First 6 images get `priority` + `fetchPriority="high"` |
| 9 | Lazy rest | `loading="lazy"`, `decoding="async"` for items 7+ |
| 10 | No CLS | Grid uses `grid-cols-{1,2,3,4}` consistent; skeleton placeholders have same `aspect-*` |
| 11 | Save data | If `navigator.connection?.saveData === true`, require click "Load more" instead of auto-trigger |
| 12 | No re-fetch page 1 | Initial items passed from server; client never requests page 1 again |
| 13 | Skeleton count | Show `pageSize` skeleton cards during load (typically 8) |
| 14 | Server-rendered first paint | `ArchiveGridClient` is hydrated after first page already in HTML |

### Image optimization

`ProductCard.tsx`:

```tsx
import Image from 'next/image';

<Image
  src={image}
  alt={name}
  fill
  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
  priority={index < 6}                      // first 6 above fold
  fetchPriority={index < 6 ? 'high' : 'auto'}
  placeholder="blur"
  blurDataURL={PLACEHOLDER_IMAGE}
  className="object-cover"
  onError={...}                             // SafeImage-style fallback
/>
```

`ComboDeals.tsx`: same pattern.

`next.config.ts`: ensure `images.remotePatterns` covers backend + R2 hostnames
(already configured; verify and add if missing).

### Files

**Backend:**
- `apps/backend/src/products/products.service.ts`
- `apps/backend/src/products/products.controller.ts`
- `apps/backend/src/combos/combos.service.ts`
- `apps/backend/src/combos/combos.controller.ts`

**Storefront:**
- `apps/storefront/lib/hooks/useInfiniteScroll.ts` (NEW)
- `apps/storefront/lib/api/products-server.ts` (NEW) — `fetchProductsServer()` for RSC
- `apps/storefront/lib/api/combos-server.ts` (NEW) — same for combos
- `apps/storefront/app/products/page.tsx` (REWRITE) — Server Component
- `apps/storefront/app/products/ArchivePageClient.tsx` (REWRITE) — thin client
- `apps/storefront/app/combos/page.tsx` (REWRITE) — same treatment
- `apps/storefront/components/ProductCard.tsx` — switch to `next/image`
- `apps/storefront/components/ComboDeals.tsx` — switch to `next/image`
- `apps/storefront/next.config.ts` — verify `images.remotePatterns`
- `apps/storefront/lib/constants.ts` — export `PRODUCT_BLUR_DATA_URL` constant

## Acceptance criteria

| Metric | Target |
|--------|--------|
| LCP (products page) | < 2.0s on Fast 3G |
| CLS | < 0.05 |
| INP | < 200ms |
| Time to first product visible | < 1.0s (server-rendered) |
| Infinite scroll trigger | 200px before sentinel exits viewport |
| Dedup correctness | Zero duplicate product cards in any test run |
| Back button | Returns to previous `?after={cursor}` state |
| Mobile Safari iOS 15+ | Infinite scroll works without jank |
| `prefers-reduced-motion` | Skeleton uses static placeholder, no shimmer animation |

## Risk / rollback

- Server Component conversion changes data flow; if something breaks, can revert page to
  Client Component with `useEffect` (URL params still work, cursor still works).
- `next/image` requires `remotePatterns`; if backend URL not whitelisted, images fall back
  to `unoptimized` (logged warning). Verify env in CI.
- `AbortController` in older browsers: not supported < Chrome 66, but our target is 2026,
  baseline 2022. Acceptable.

## Testing

- `apps/storefront/__tests__/useInfiniteScroll.test.ts` (NEW)
  - Dedup test
  - Abort test
  - Visibility pause test
  - End-of-list test
  - Retry test
  - URL sync test
- Manual smoke: dev server, hard reload, scroll, hard reload mid-scroll
- Lighthouse CI pass on products page
