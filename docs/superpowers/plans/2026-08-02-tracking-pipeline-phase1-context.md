# CAPI Tracking Pipeline — Phase 1: TrackingContext Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the cross-provider browser context (`fbp`, `fbc`, `fbclid`, `gclid`, `ttclid`, `_ga`, ip, UA, `external_id`) **before** order creation and link it to the order via `Order.trackingSessionId`, so a delayed Purchase later has the same match keys as an instant one.

**Architecture:** Phase 1 of the approved design (`docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md`, §4.1/§4.12/§5). The browser `TrackingClient` generates a stable `ctxId`, reads provider cookies/URL params, and upserts a `TrackingContext` row server-side (serialized per `ctxId`, first-non-empty-wins for static ids, rotate-never-clear for cookies). Order-create carries `ctxId` → `Order.trackingSessionId`. `saveContext`/`getContext` switch from the legacy `TrackingEvent` table to `TrackingContext` (table stays — dropped in Phase 3).

**Tech Stack:** NestJS 11, Prisma 7, Next.js 16 (RSC), Vitest (storefront), Jest (backend).

## Global Constraints

- **Backend rules:** DTOs with `class-validator`; `$transaction` for multi-write; thin controllers; run `npm run build --workspace=backend` before completion; Jest for behavior changes.
- **Storefront rules:** React Server Components default; `use client` only for browser APIs/interactivity; Vitest for targeted tests; run `npm run build --workspace=storefront` before completion.
- **AGENTS.md:** any `schema.prisma` change → instant migration; commit schema+migration atomically. (Phase 1 adds **no** schema change — `TrackingContext` and `Order.trackingSessionId` already exist from Phase 0.)
- **Design invariants:** context merge is serialized per `ctxId`; static ids (`externalId`) first-non-empty; rotating ids (`fbp`,`fbc`,`gclid`,`ttclid`,`_ga`) replace-when-newer, **never** clear; `externalId` is server-generated; ip/UA always from the backend request, never the browser.
- **No runtime dispatch change:** Phase 1 does not wire the outbox/dispatcher (Phases 3-4). Existing Meta/TikTok/GA4 senders keep working unchanged.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/src/tracking/context-merge.ts` | Create | Pure `mergeContext(existing, incoming)` implementing the enrichment rules |
| `apps/backend/src/tracking/__tests__/context-merge.spec.ts` | Create | Unit tests for the merge rules |
| `apps/backend/src/tracking/tracking-context.service.ts` | Create | `upsertContext(ctxId, fields)` serialized merge + `getByCtxId` |
| `apps/backend/src/tracking/__tests__/tracking-context.service.spec.ts` | Create | Unit tests (mocked prisma) |
| `apps/backend/src/tracking/dto/save-context.dto.ts` | Modify | `orderId` → `ctxId` (keep optional fbp/fbc/url/referrer + new identifiers) |
| `apps/backend/src/tracking/tracking.controller.ts` | Modify | `/tracking/context` uses `ctxId` upsert; `/tracking/events` accepts `ctxId` |
| `apps/backend/src/tracking/tracking.service.ts` | Modify | `saveContext`/`getContext` → TrackingContext; stop writing `TrackingEvent` |
| `apps/backend/src/tracking/tracking.module.ts` | Modify | register `TrackingContextService` |
| `apps/backend/src/orders/dto/create-order.dto.ts` | Modify | add `trackingSessionId?` |
| `apps/backend/src/orders/orders.service.ts` | Modify | set `Order.trackingSessionId` on create; read context by `trackingSessionId` in `buildAndSendPurchaseEvent` |
| `apps/storefront/lib/tracking-client.ts` | Create | `TrackingClient`: ctxId, cookie/URL reads, throttled `/tracking/context` upsert |
| `apps/storefront/lib/__tests__/tracking-client.spec.ts` | Create | Vitest unit tests |
| `apps/storefront/components/TrackingScripts.tsx` | Modify | init `TrackingClient` on load |
| `apps/storefront/lib/tracking.ts` | Modify | include `ctxId` in `/tracking/events` mirror |
| `apps/storefront/app/(main)/checkout/page.tsx` | Modify | `buildOrderPayload` includes `trackingSessionId` (ctxId) |
| `apps/storefront/app/(main)/checkout/thank-you/ThankYouContent.tsx` | Modify | save context via ctxId, not orderId |

---
### Task 1: Context merge rules (pure function)

**Files:**
- Create: `apps/backend/src/tracking/context-merge.ts`
- Create: `apps/backend/src/tracking/__tests__/context-merge.spec.ts`

**Interfaces:**
- Produces: `mergeContext(existing: Record<string, any> | null, incoming: Record<string, any>): { identifiers: Record<string, any>; url?: string; referrer?: string }`. `identifiers` shape per design §4.1: `{ [provider]: { [key]: { value, firstSeenAt?, lastSeenAt? } } }`. Note: customer contact fields (`email`/`phone`) live in the **snapshot** (design §12), not context — this function handles session identifiers + page context only.

- [ ] **Step 1: Write the failing test**

`apps/backend/src/tracking/__tests__/context-merge.spec.ts`:

```ts
import { mergeContext } from '../context-merge';

describe('mergeContext (design §4.1 enrichment rules)', () => {
  it('starts empty', () => {
    const r = mergeContext(null, {});
    expect(r.identifiers).toEqual({});
  });

  it('stores incoming cookie identifiers with provenance', () => {
    const r = mergeContext(null, {
      identifiers: { meta: { fbp: 'fb.1.123.456', fbc: 'fb.1.7.X' } },
    });
    expect(r.identifiers.meta.fbp.value).toBe('fb.1.123.456');
    expect(r.identifiers.meta.fbp.firstSeenAt).toBeDefined();
  });

  it('rotating cookie id: replace when a newer value arrives, never clear', () => {
    const r1 = mergeContext(null, { identifiers: { meta: { fbp: { value: 'fb.1.111.1' } } } });
    const r2 = mergeContext(r1, { identifiers: { meta: { fbp: 'fb.1.222.2' } } });
    expect(r2.identifiers.meta.fbp.value).toBe('fb.1.222.2');
    expect(r2.identifiers.meta.fbp.firstSeenAt).toBeDefined();
    const r3 = mergeContext(r2, { identifiers: { meta: { fbp: '' } } });
    expect(r3.identifiers.meta.fbp.value).toBe('fb.1.222.2'); // empty never clears
  });

  it('merges provider namespaces independently', () => {
    const r1 = mergeContext(null, { identifiers: { meta: { fbp: 'x' } } });
    const r2 = mergeContext(r1, { identifiers: { google: { gaClientId: 'G-1' } } });
    expect(r2.identifiers.meta.fbp.value).toBe('x');
    expect(r2.identifiers.google.gaClientId.value).toBe('G-1');
  });

  it('updates url/referrer to the latest non-empty value', () => {
    const r1 = mergeContext(null, { url: '/a', referrer: '/r1' });
    const r2 = mergeContext(r1, { url: '/b' });
    expect(r2.url).toBe('/b');
    expect(r2.referrer).toBe('/r1');
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `cd apps/backend && npx jest src/tracking/__tests__/context-merge.spec.ts`
Expected: FAIL (`Cannot find module '../context-merge'`).

- [ ] **Step 3: Implement**

`apps/backend/src/tracking/context-merge.ts`:

```ts
export interface ProviderIdentifier {
  value: string;
  firstSeenAt: string;
  lastSeenAt?: string;
}
export interface IncomingIdentifiers {
  [provider: string]: { [key: string]: string | undefined };
}
export interface StoredIdentifiers {
  [provider: string]: { [key: string]: ProviderIdentifier };
}
export interface ContextInput {
  identifiers?: IncomingIdentifiers;
  url?: string;
  referrer?: string;
}
export interface ContextMerged {
  identifiers: StoredIdentifiers;
  url?: string;
  referrer?: string;
}

/** Cookie-based identifiers rotate across sessions: replace-when-newer, never clear. */
const ROTATING = new Set(['fbp', 'fbc', 'gclid', 'ttclid', '_ga', 'fbclid', '_ttp']);

export function mergeContext(
  existing: ContextMerged | null,
  incoming: ContextInput,
): ContextMerged {
  const out: ContextMerged = {
    identifiers: existing?.identifiers ?? {},
    url: existing?.url,
    referrer: existing?.referrer,
  };
  const now = new Date().toISOString();

  for (const [provider, keys] of Object.entries(incoming.identifiers ?? {})) {
    out.identifiers[provider] = out.identifiers[provider] ?? {};
    for (const [key, value] of Object.entries(keys)) {
      if (!value) continue; // empty never clears
      const prev = out.identifiers[provider][key];
      if (!prev) {
        out.identifiers[provider][key] = { value, firstSeenAt: now, lastSeenAt: now };
      } else if (ROTATING.has(key) && prev.value !== value) {
        out.identifiers[provider][key] = { value, firstSeenAt: prev.firstSeenAt, lastSeenAt: now };
      }
      // static ids: first non-empty wins
    }
  }

  if (incoming.url) out.url = incoming.url;
  if (incoming.referrer) out.referrer = incoming.referrer;
  return out;
}
```

- [ ] **Step 4: Run test → PASS**
- [ ] **Step 5: Commit** `feat(tracking): add context merge enrichment rules`

---
### Task 2: TrackingContextService (serialized upsert + read)

**Files:**
- Create: `apps/backend/src/tracking/tracking-context.service.ts`
- Create: `apps/backend/src/tracking/__tests__/tracking-context.service.spec.ts`
- Modify: `apps/backend/src/tracking/tracking.module.ts` (register)

**Interfaces:**
- Consumes: `mergeContext` (Task 1), `PrismaService`, NestJS `Logger`.
- Produces: `TrackingContextService.upsertContext(ctxId, input, ip, userAgent): Promise<void>` and `TrackingContextService.getByCtxId(ctxId): Promise<TrackingContext | null>`.

- [ ] **Step 1: Write the failing test**

`apps/backend/src/tracking/__tests__/tracking-context.service.spec.ts`:

```ts
import { TrackingContextService } from '../tracking-context.service';
import { mergeContext } from '../context-merge';

describe('TrackingContextService', () => {
  const tx = { trackingContext: { upsert: jest.fn(), findUnique: jest.fn() } };
  const prisma = { $transaction: jest.fn((cb) => cb(tx)) } as any;
  const service = new TrackingContextService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('upserts via a transaction with server-set ip/userAgent and serialized merge', async () => {
    tx.trackingContext.findUnique.mockResolvedValue(null);
    await service.upsertContext('ctx-1', { identifiers: { meta: { fbp: 'x' } } }, '1.2.3.4', 'UA');
    expect(prisma.$transaction).toHaveBeenCalled();
    const [call] = tx.trackingContext.upsert.mock.calls;
    expect(call[0].where).toEqual({ ctxId: 'ctx-1' });
    expect(call[0].create.ip).toBe('1.2.3.4');
    expect(call[0].create.userAgent).toBe('UA');
    expect(call[0].create.externalId).toBeDefined(); // server-generated
  });

  it('merges into the existing row and never trusts browser ip/ua', async () => {
    const existing = {
      id: 'id-1', ctxId: 'ctx-1', externalId: 'ext-1', ip: '9.9.9.9', userAgent: 'UA-old',
      url: null, referrer: null, identifiers: { meta: { fbp: { value: 'old', firstSeenAt: 't' } } },
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    tx.trackingContext.findUnique.mockResolvedValue(existing);
    await service.upsertContext('ctx-1', { identifiers: { meta: { fbp: 'new' } } }, '5.5.5.5', 'UA-new');
    const [, update] = tx.trackingContext.upsert.mock.calls[0];
    expect(update.update.identifiers.meta.fbp.value).toBe('new'); // rotating: replaced
    expect(update.update.ip).toBeUndefined();                     // ip/ua never overwritten
    expect(update.update.userAgent).toBeUndefined();
  });

  it('getByCtxId returns the row or null', async () => {
    tx.trackingContext.findUnique.mockResolvedValue(null);
    await expect(service.getByCtxId('nope')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL**
- [ ] **Step 3: Implement**

`apps/backend/src/tracking/tracking-context.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mergeContext, ContextInput } from './context-merge';

@Injectable()
export class TrackingContextService {
  private readonly logger = new Logger(TrackingContextService.name);
  constructor(private readonly prisma: PrismaService) {}

  async upsertContext(
    ctxId: string,
    input: ContextInput,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize per ctxId: read current row, merge, then upsert (no lost updates).
        const row = await tx.trackingContext.findUnique({ where: { ctxId } });
        const merged = mergeContext(row, input);
        await tx.trackingContext.upsert({
          where: { ctxId },
          create: {
            ctxId,
            externalId: crypto.randomUUID(), // server-generated, stable per journey
            ip,
            userAgent,
            url: merged.url ?? undefined,
            referrer: merged.referrer ?? undefined,
            identifiers: merged.identifiers,
          },
          update: {
            url: merged.url ?? undefined,
            referrer: merged.referrer ?? undefined,
            identifiers: merged.identifiers,
          },
        });
      });
    } catch (err) {
      this.logger.warn(`Failed to upsert tracking context ${ctxId}: ${err}`);
    }
  }

  async getByCtxId(ctxId: string) {
    return this.prisma.trackingContext.findUnique({ where: { ctxId } });
  }
}
```

**Note on ip/UA:** the upsert reads the existing row first; `mergeContext` never changes `ip`/`userAgent`, and the update only writes `email/phone/url/referrer/identifiers`, so existing ip/UA are preserved. First-write sets them from the request.

- [ ] **Step 4: Run test → PASS** (adjust: `crypto.randomUUID()` needs `globalThis.crypto` — Node 18+ provides it; if the test env lacks it, mock it in the test file.)
- [ ] **Step 5: Register in `tracking.module.ts`** (import + add to providers). Run `npm run build --workspace=backend`.
- [ ] **Step 6: Commit** `feat(tracking): add TrackingContextService with serialized upsert`

---
### Task 3: Order linkage (`Order.trackingSessionId`)

> Ordering note: this runs BEFORE the `/tracking/context` switch so the backend keeps compiling — `orders.service` stops calling the legacy `getContext` before Task 4 removes it.

**Files:**
- Modify: `apps/backend/src/orders/dto/create-order.dto.ts`
- Modify: `apps/backend/src/orders/orders.service.ts`

**Interfaces:**
- Consumes: `TrackingContextService.getByCtxId` (Task 2).
- Produces: `CreateOrderDto.trackingSessionId?: string`; orders created with it store `Order.trackingSessionId`; `buildAndSendPurchaseEvent` reads context via the order's `trackingSessionId`.

- [ ] **Step 1: Add to `CreateOrderDto`:**

```ts
@IsString()
@IsOptional()
trackingSessionId?: string;
```

- [ ] **Step 2: In `orders.service.create`**, set `trackingSessionId: dto.trackingSessionId` when the order is inserted (an unknown/missing ctxId is tolerated — the dispatcher degrades gracefully).
- [ ] **Step 3: In `buildAndSendPurchaseEvent`**, replace `const savedCtx = await this.tracking.getContext(order.id);` with context lookup via the order's `trackingSessionId`:

```ts
let savedCtx: any = null;
if (order.trackingSessionId) {
  savedCtx = await this.trackingContext.getByCtxId(order.trackingSessionId);
}
```
Inject `TrackingContextService` into `OrdersService`. Keep the same `fbp/fbc/url/referrer` extraction from `savedCtx`. (Old orders with no `trackingSessionId` degrade gracefully — no context.)
- [ ] **Step 4: Update/extend `orders.service.spec.ts`** for the linkage + context lookup path. Run backend tests + build. **Commit** `feat(orders): link orders to tracking context via trackingSessionId`

---
### Task 4: `/tracking/context` ctxId-based endpoint + switch saveContext/getContext

**Files:**
- Modify: `apps/backend/src/tracking/dto/save-context.dto.ts`
- Modify: `apps/backend/src/tracking/tracking.controller.ts`
- Modify: `apps/backend/src/tracking/tracking.service.ts`

**Interfaces:**
- Consumes: `TrackingContextService` (Task 2), the order linkage from Task 3.
- Produces: `POST /tracking/context` body `{ ctxId, identifiers?, url?, referrer? }` (ip/UA added server-side). `TrackingService` no longer reads/writes `TrackingEvent` for context (`getContext` is safe to remove now — `orders.service` already reads via `trackingSessionId`).

- [ ] **Step 1: Replace `SaveContextDto`** with:

```ts
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class SaveContextDto {
  @IsString()
  @IsNotEmpty()
  ctxId: string;

  @IsObject()
  @IsOptional()
  identifiers?: Record<string, Record<string, string | undefined>>;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  referrer?: string;
}
```

- [ ] **Step 2: Update `tracking.controller.ts`** — `saveContext(body, req)` calls `trackingContext.upsertContext(body.ctxId, { identifiers, url, referrer }, req.ip, req.headers['user-agent'])` (inject `TrackingContextService`). Remove the old `tracking.saveContext(orderId, …)` path.
- [ ] **Step 3: Update `tracking.service.ts`** — keep `tracking.track` (queue enqueue) unchanged; **remove** `saveContext`/`getContext` (context now lives in `TrackingContext`; no caller remains after Task 3).
- [ ] **Step 4: Update the tracking controller spec** (`__tests__/tracking.controller.spec.ts`) — method list unchanged (`trackEvent`, `saveContext` still exist).
- [ ] **Step 5: Run backend tests + build** → PASS. **Commit** `feat(tracking): switch /tracking/context to ctxId-based TrackingContext`

---
### Task 5: Storefront TrackingClient

**Files:**
- Create: `apps/storefront/lib/tracking-client.ts`
- Create: `apps/storefront/lib/__tests__/tracking-client.spec.ts`

**Interfaces:**
- Produces: `getOrCreateCtxId(): string` (localStorage `ecomate_ctx_id`); `collectIdentifiers(): Record<string, Record<string, string>>` (cookies `_fbp,_fbc,_ga,_ttp` + URL params `fbclid,gclid,ttclid`); `syncContext(payload?): Promise<void>` throttled POST `/tracking/context` with `ctxId`; `getCtxId(): string`.

- [ ] **Step 1: Write the failing test** (Vitest; mock `localStorage`, `document.cookie`, `fetch`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateCtxId, collectIdentifiers, syncContext } from '../tracking-client';

describe('tracking-client', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = '_fbp=fb.1.1.1; _fbc=fb.1.2.3; _ga=GA1.2.5; _ttp=tt.1';
    vi.restoreAllMocks();
  });

  it('creates a stable ctxId and reuses it', () => {
    const a = getOrCreateCtxId();
    const b = getOrCreateCtxId();
    expect(a).toBe(b);
  });

  it('collects provider identifiers from cookies and URL params', () => {
    // URL has fbclid=gclid=ttclid values
    const ids = collectIdentifiers();
    expect(ids.meta.fbp).toBe('fb.1.1.1');
    expect(ids.meta.fbc).toBe('fb.1.2.3');
    expect(ids.google.gaClientId).toBe('GA1.2.5');
  });

  it('posts ctxId + identifiers to /tracking/context', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    await syncContext();
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/context');
    const body = JSON.parse(init.body);
    expect(body.ctxId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test → FAIL**
- [ ] **Step 3: Implement `tracking-client.ts`** (SSR-safe; no-op when `typeof window === 'undefined'`):

```ts
const CTX_KEY = 'ecomate_ctx_id';

export function getOrCreateCtxId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(CTX_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(CTX_KEY, id);
  }
  return id;
}
export const getCtxId = getOrCreateCtxId;

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

export function collectIdentifiers(): Record<string, Record<string, string>> {
  const ids: Record<string, Record<string, string>> = {};
  const meta: Record<string, string> = {};
  const fbp = getCookie('_fbp'); if (fbp) meta.fbp = fbp;
  const fbc = getCookie('_fbc'); if (fbc) meta.fbc = fbc;
  if (!fbc && typeof location !== 'undefined') {
    const fbclid = new URLSearchParams(location.search).get('fbclid');
    if (fbclid) meta.fbclid = fbclid;
  }
  if (Object.keys(meta).length) ids.meta = meta;
  const tiktok: Record<string, string> = {};
  const ttp = getCookie('_ttp'); if (ttp) tiktok._ttp = ttp;
  if (typeof location !== 'undefined') {
    const ttclid = new URLSearchParams(location.search).get('ttclid');
    if (ttclid) tiktok.ttclid = ttclid;
  }
  if (Object.keys(tiktok).length) ids.tiktok = tiktok;
  const google: Record<string, string> = {};
  const ga = getCookie('_ga'); if (ga) google.gaClientId = ga;
  if (typeof location !== 'undefined') {
    const gclid = new URLSearchParams(location.search).get('gclid');
    if (gclid) google.gclid = gclid;
  }
  if (Object.keys(google).length) ids.google = google;
  return ids;
}

let inflight: Promise<void> | null = null;
export async function syncContext(payload?: {
  identifiers?: Record<string, Record<string, string>>;
  url?: string;
  referrer?: string;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  if (inflight) return inflight; // throttle: one at a time
  inflight = (async () => {
    try {
      const base = (location.hostname.includes('localhost') ? (process.env.API_URL || 'http://localhost:4000') : '') + '/api';
      await fetch(`${base}/tracking/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ctxId: getOrCreateCtxId(),
          identifiers: payload?.identifiers ?? collectIdentifiers(),
          url: payload?.url ?? location.href,
          referrer: payload?.referrer ?? document.referrer,
        }),
        keepalive: true,
      });
    } catch {
      /* best-effort — never block the page */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
```

- [ ] **Step 4: Run test → PASS**
- [ ] **Step 5: Commit** `feat(storefront): add TrackingClient (ctxId + context sync)`

---
### Task 6: Wire TrackingClient into the app

**Files:**
- Modify: `apps/storefront/components/TrackingScripts.tsx`
- Modify: `apps/storefront/lib/tracking.ts`
- Modify: `apps/storefront/app/(main)/checkout/page.tsx`
- Modify: `apps/storefront/app/(main)/checkout/thank-you/ThankYouContent.tsx`

**Interfaces:**
- Consumes: Task 5 exports.
- Produces: ctxId flows into `/tracking/context`, `/tracking/events`, and the order-create payload (`trackingSessionId`).

- [ ] **Step 1: `TrackingScripts.tsx`** — in the existing `useEffect`, call `syncContext()` on mount (init context capture) alongside `setPixelIds`. Import from `@/lib/tracking-client`.
- [ ] **Step 2: `lib/tracking.ts`** — in the `/tracking/events` mirror POST body, add `ctxId: getOrCreateCtxId()`. Keep everything else identical.
- [ ] **Step 3: `checkout/page.tsx`** — in `buildOrderPayload()` (or the `createOrder(payload)` call), add `trackingSessionId: getOrCreateCtxId()` to the payload so `CreateOrderDto.trackingSessionId` is populated.
- [ ] **Step 4: `ThankYouContent.tsx`** — replace the `/tracking/context` fetch (keyed by `orderId`) with `syncContext()` (keyed by `ctxId`) and keep the fbp/fbc collection via `collectIdentifiers()`. Remove the orderId-keyed context POST.
- [ ] **Step 5: Run storefront tests + build** (`npm run test --workspace=storefront`, `npm run build --workspace=storefront`). Run backend tests + build. **Commit** `feat(storefront): wire tracking context capture into checkout + events`

---
## Self-Review Notes

- **Spec coverage:** Tasks 1-2 = §4.1 enrichment + serialized upsert; Task 3 = §5/§4.12 context endpoint + `saveContext`/`getContext` switch (TrackingEvent stops being written, stays until Phase 3 drop); Task 4 = `Order.trackingSessionId` linkage + delayed-purchase context read; Tasks 5-6 = browser `TrackingClient` + wiring.
- **Type consistency:** `mergeContext` output shape (Task 1) matches `TrackingContextService.upsert` fields (Task 2) matches `SaveContextDto.identifiers` (Task 3) matches `collectIdentifiers` (Task 5). `ctxId` is the single key everywhere; `trackingSessionId` (Task 4) equals ctxId.
- **Placeholders:** none — every step has complete code.
- **Migration:** Phase 1 adds **no** schema change (`TrackingContext`, `Order.trackingSessionId` exist from Phase 0) — no new migration needed.
