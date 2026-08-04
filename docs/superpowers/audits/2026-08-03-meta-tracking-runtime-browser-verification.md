# EcoMate Meta Tracking — Phase-2A: Runtime Browser Tracking Verification

**Phase-2A — Evidence collection only. No fixes, no optimization, no Meta-documentation comparison.**
**Date:** 2026-08-03
**Branch:** `main` tip `19382d51` (worktree `peaceful-leavitt-47d1cd`)
**Scope:** the complete browser-side runtime flow of tracking events — bootstrap, Pixel, network, mirror, Meta delivery — plus every execution-order and timing factor that could make a browser event missing while the corresponding server CAPI event is present.

---

## 1. Evidence-collection method and constraints

This is a **runtime-flow verification**. The runtime sequence is traced from the actual executing code in bundle order (the deterministic bootstrap / event / hydration path in `apps/storefront`), cross-checked against Next.js 16 behavior for `lazyOnload`, hydration, and rewrites.

**Constraint (honest):** this worktree has no `node_modules`, no backend, no Redis/Postgres, and no real Meta Pixel credentials. Without a real `meta.pixelId` and a working backend, the pixel cannot initialize, so **live observation of the outbound browser → Meta network requests (fbevents.js → connect.facebook.net), Events Manager, and the Test-Events tool is NOT possible from this sandbox.** Those observations are marked **UNABLE TO VERIFY (needs credentialed staging)**. Everything deterministic in code is fully verified with file:line evidence; the "browser missing / CAPI present" causes are code-traced with evidence.

Source files read in full:
- `apps/storefront/app/layout.tsx`
- `apps/storefront/context/StorefrontConfigContext.tsx`
- `apps/storefront/lib/tracking.ts`
- `apps/storefront/lib/tracking-client.ts`
- `apps/storefront/components/TrackingScripts.tsx`
- `apps/storefront/components/PageViewTracker.tsx`
- `apps/storefront/next.config.ts`
- `apps/storefront/app/(main)/checkout/thank-you/ThankYouContent.tsx`
- `apps/storefront/app/(main)/checkout/page.tsx`

---

## 2. Pixel bootstrap sequence

Verified order:

1. **SSR**: `layout.tsx` calls the server config (`getStorefrontConfigServer`, cached `revalidate: 60`) and injects the result as a JSON blob `<script id="__INITIAL_CONFIG__">` (layout.tsx:164-166), passed to `StorefrontConfigProvider` (layout.tsx:182).
2. **Hydration**: `StorefrontConfigProvider` seeds state from `initialConfig || getBootstrappedConfig() || DEFAULT_CONFIG` (StorefrontConfigContext.tsx:60-62). So `config.meta.{pixelEnabled, pixelId, purchaseMode, validatedStatus}` are available client-side without a second fetch.
3. `<TrackingScripts />` is a client component rendered in `<body>` **before `{children}`** (layout.tsx:183). Its `useEffect` on mount:
   - `setPixelIds(metaId, tiktokCode)` → sets module `_metaId/_tiktokCode`, calls `flushQueue()` (tracking.ts:34-38),
   - `setTrackingConfig(meta.purchaseMode, tiktok.purchaseMode)` → module modes (tracking.ts:40-44),
   - `syncContext()` → POST `/tracking/context` (TrackingScripts.tsx:27).
4. **Pixel scripts load lazily**: `<Script strategy="lazyOnload" dangerouslySetInnerHTML>` (TrackingScripts.tsx:40) defines the fbq/ttq/gtag stubs, injects `fbevents.js` / TikTok `events.js` / `gtag.js` asynchronously, calls `fbq('init', metaId)`, `fbq('track','PageView')`, `ttq.load`, `ttq.page()`, `gtag config`, then `window.__flushTrackingQueue()` (TrackingScripts.tsx:43-102).
5. **`flushQueue()`** drains `_eventQueue` (tracking.ts:46-71) once fbq/ttq exist.

**Key gate**: `TrackingScripts` renders nothing when no provider id — `if (!hasAny) return null` (TrackingScripts.tsx:36), where `hasAny = !!(metaId || tiktokCode || gaMeasurementId)`. If `meta.pixelEnabled` is false or `pixelId` is empty, `metaId = ""` and the Meta pixel network requests never happen.

---

## 3. fbq initialization

- `fbq('init', metaId)` passes **only the pixel id** (TrackingScripts.tsx:59). No `external_id`, no Advanced-Matching `user_data`, no test code.
- The fbq function stub is created **synchronously** in the inline snippet (`n = f.fbq = function(){ … n.queue.push(arguments) }`, TrackingScripts.tsx:51-54), so immediately after the inline script runs, `window.fbq` is truthy and buffered calls are queued until `fbevents.js` loads. This is what preserves events that fire before the network tag arrives.
- A `if (metaId && !window.fbq)` guard (TrackingScripts.tsx:49) prevents double stub creation.

---

## 4. fbq track execution

`trackEvent(event, data, userData, eventId)` (tracking.ts:91):

1. `if (typeof window === 'undefined') return;` — **no SSR double-fire** (tracking.ts:93).
2. Synthetic-email filter (tracking.ts:95-98) — strips `cust_` / all-numeric local parts from the mirrored userData.
3. **Purchase mode gate** (tracking.ts:100-107): `if (event === 'Purchase')` and neither provider is `instant` → `return`. This is the **validated-mode** browser suppression.
4. `const resolvedEventId = eventId ?? generateEventId();` (tracking.ts:111) — the dedup key used for both Pixel and mirror.
5. **Queue vs fire** (tracking.ts:117-146):
   - no ids set → `_eventQueue.push(...)`;
   - else if `(_metaId && !fbq) || (_tiktokCode && !ttq)` → `_eventQueue.push(...)` (buffered until the script loads);
   - else → `fbq('track', event, data, {eventID})` (line 126), `ttq.track(...)` (line 131), and `gtag('event', …)` when present (lines 133-145).
6. **Mirror POST** (tracking.ts:153-173): if `_metaId || _tiktokCode`, `fetch(getTrackingApiUrl() + '/tracking/events', { keepalive: true })` with `ctxId`, `eventId: resolvedEventId`, `eventName: snake(event)`, `customData`, `userData` (incl. fbp/fbc/url/referrer). Errors → `.catch(console.error)` only.
7. Return.

**Effective fan-out per event**: (a) Meta Pixel via fbq, (b) the mirror `/tracking/events` → server CAPI, (c) gtag (GA4) when present. One event produces up to three network paths.

---

## 5. Network requests (browser side)

| Path | URL | Trigger | Notes |
|---|---|---|---|
| Pixel script | `https://connect.facebook.net/en_US/fbevents.js` | injected by inline snippet | third-party; ad-blockable |
| Pixel beacon | `https://www.facebook.com/tr/?…` | `fbq('track')` | Meta-owned; carries `eid` = eventID |
| gtag script | `https://www.googletagmanager.com/gtag/js?id=…` | injected | third-party |
| GA4 beacon | `https://www.google-analytics.com/g/collect` | `gtag('event')` | third-party |
| TikTok | `https://analytics.tiktok.com/i18n/pixel/events.js` + beacon | injected / `ttq.track` | third-party |
| Context | `/api/tracking/context` | `syncContext()` | **same-origin** (rewritten to backend) |
| Mirror | `/api/tracking/events` | `trackEvent` | **same-origin**, `keepalive: true` |
| Analytics PageView | `/api/tracking/page-view` | `PageViewTracker` | same-origin, `sendBeacon` |

**Crucial asymmetry**: Meta Pixel + gtag + TikTok emit to **third-party** hosts. The CAPI mirror + context POST to **same-origin `/api/*`**, which `next.config.ts:58-63` rewrites to the backend. A third-party-script blocker (ad blocker), or an edge CSP that blocks `facebook.com` / `googletagmanager.com`, suppresses Pixel/gtag events **while leaving the same-origin mirror untouched** → "browser event missing, server CAPI present" (matrix row C1).

---

## 6. Browser → server mirror payload

`/tracking/events` body (tracking.ts:157-168):

```json
{
  "ctxId":     getOrCreateCtxId(),
  "eventId":   resolvedEventId,   // purchase_{orderId} for Purchase, else Date.now()-base
  "eventName": snake(event),      // view_content, add_to_cart, initiate_checkout, purchase, ...
  "customData": data,             // value, currency, content_ids, contents, num_items, order_id, ...
  "userData":  { ...userData, fbp, fbc, url, referrer }
}
```

Server maps `customData` → snapshot payload and `userData.email/phone/name/...` → `customer`, **but `fbp/fbc/url/referrer` inside `userData` are dropped by the controller** (tracking.controller.ts maps only the named customer fields). The CAPI match keys fbp/fbc/url therefore come from `TrackingContext` (the `/tracking/context` POST), not from this body.

---

## 7. eventID propagation

- **Purchase**: `resolvedEventId = purchase_{orderId}` — passed to fbq (`{eventID: resolvedEventId}`, tracking.ts:126) and to the mirror (ThankYouContent.tsx:104 passes `purchase_${order.id}`). Same key as the server CAPI capture → capture-once + shared dedup key.
- **All other events**: `generateEventId() = ${Date.now()}-${Math.random().toString(36).slice(2,10)}` (tracking.ts:20-22). Every call yields a new id, so a repeated fire creates a new mirror snapshot with no capture-time dedup for non-Purchase events (Discovery G8).

---

## 8. `_fbp` / `_fbc` propagation

- Read in `collectIdentifiers()` (tracking-client.ts:34-39): `_fbp`, `_fbc`, plus URL `fbclid`. Bundled into `identifiers.meta.{fbp, fbc, fbclid}` and POSTed via `syncContext()` → `/tracking/context`.
- `_fbp` is **created by Meta's `fbevents.js` after its first load**, not by our code. On a **fresh first visit**, the on-mount `syncContext` runs before Meta writes `_fbp`, so the first page's `TrackingContext` has **no fbp**. Later pages pick it up. A first-visit server CAPI event can therefore dispatch with an empty fbp even though the browser Pixel fired.
- `_fbc` exists only when the visitor arrived via a Meta click carrying `fbclid`.

---

## 9. Browser → Meta delivery mechanism

`fbq('track', E, data, {eventID})` → Meta's `fbevents.js` POSTs pixel events to `https://www.facebook.com/tr/` (Meta-owned URL), carrying `eid` = eventID, the event name, custom data, and the pixel id. fbp/fbc are read and attached by Meta's own script, not by us. **No `external_id` is passed** (`fbq('init', metaId)` only), so the browser hands Meta no cross-device identity; our `external_id` exists only on the CAPI side (Discovery G3). **UNABLE TO VERIFY** the exact wire payload / batch-splitting without a credentialed run.

---

## 10. Browser → Test Events / Events Manager visibility

- The Pixel init/track carry **no test-event code** on the browser (init passes only the pixel id — Discovery §20). Browser-side Test Events / debug mode must be enabled in Meta's own dashboard for the pixel; **nothing in this code enables it**.
- What the browser sends is a standard fbq stream with `eventID` on every event. Because `trackEvent` uses the **same `resolvedEventId`** for the Pixel and the mirror, Pixel and CAPI share an eventID for every mirrored event at the browser level — but for non-Purchase events that id is random per call, so a duplicate fire yields two ids.
- **UNABLE TO VERIFY**: actual Events-Manager rows, Test-Event delivery, dedup KPIs — needs credentials.

---

## 11. SPA navigation

- **PageView**: `fbq('track','PageView')` fires only in the inline snippet, **once per full page load** (TrackingScripts.tsx:60). There is **no per-route PageView** on client-side navigation — the Next router does not call fbq. Internal SPA route changes therefore emit **no new Meta PageView**; PageView reflects only the initial hard load.
- **Per-route events**: `ViewContent` / `AddToCart` / `InitiateCheckout` run in route-component `useEffect`s, so they DO fire again on each SPA mount (subject to the effect guards below).
- The analytics `/tracking/page-view` fires per distinct URL via `PageViewTracker` (`sentUrlRef` dedups repeats) — a **separate** buffer path, not Meta.

---

## 12. Thank-you page timing

`ThankYouContent` Purchase effect:

1. `if (!order) return;` — **no Purchase if the order object is missing/errored** (ThankYouContent.tsx:66, 112).
2. `sessionStorage` guard `tracked_order_{order.id}` prevents a double Purchase across StrictMode remounts / refresh (lines 70-71, 109).
3. `fireMeta` / `fireTiktok` = mode `instant` (lines 73-76). Validated → nothing fires.
4. `trackEvent('Purchase', sharedData, sharedUserData, purchase_${order.id})` (line 104) — Pixel + mirror + gtag.
5. **`syncContext()` runs AFTER the Purchase trackEvent** (line 107) — the fbp/fbc/url context for the purchase is updated after the Purchase fired. The mirror body does not carry fbp/fbc (dropped server-side), so the CAPI dispatch reads `TrackingContext`, which was synced earlier in the journey (product/checkout pages). On a **direct deep-link to `/thank-you`** (no earlier pages), the context may be missing or stale at CAPI dispatch time → degraded match keys even though the browser Pixel Purchase is fine.
6. `sessionStorage.setItem(...)` last.

---

## 13. Race conditions

| Race | Evidence | Effect |
|---|---|---|
| **A. First-load `_fbp`** — Meta writes `_fbp` after our `syncContext` | tracking-client:34-39 vs fbevents.js behavior | first-visit context has no fbp → CAPI event still sent, fbp empty |
| **B. `flushQueue` guard vs single provider, script not yet loaded** — the guard `(_metaId && !fbq) && (_tiktokCode && !ttq)` only returns when BOTH providers are pending; with **one** provider enabled and its script not yet defined, `flushQueue()` proceeds to the drain and clears the queue without firing | tracking.ts:56-70 | events queued in the window between `trackEvent` and the lazy script can be dropped from the **browser** while the same-origin mirror still posts → "browser missing, CAPI present". Latent (only if a `trackEvent` runs before the first flush with fbq undefined); **Medium** confidence |
| **C. Order-create vs mirror dedup** | order txn captures `purchase_{orderId}` (UNIQUE); browser mirror uses the same id | whichever insert lands first wins (server usually) → mirror returns `DEDUPED`, no double snapshot |
| **D. Thank-you `syncContext` after Purchase** | ThankYouContent:104 then :107 | context freshness lags the Purchase event |
| **E. SSR → client config loss** | if `initialConfig` / `__INITIAL_CONFIG__` missing (SSR fetch failed) → `DEFAULT_CONFIG`, `hasAny = false` | no tracking at all; page shows the "Unable to Load" error |

---

## 14. Ad blocker, CSP, lazy-loading, hydration, duplicate suppression

- **Ad blockers**: block the third-party hosts (`connect.facebook.com`, `googletagmanager.com`, `analytics.tiktok.com`) — suppressing Pixel/gtag/TikTok events **but not the same-origin `/api` mirror**. This is the most probable external cause of "browser Pixel missing, CAPI present".
- **CSP**: the storefront sets **no** `Content-Security-Policy` (next.config.ts:34-47 headers are X-Frame / X-Content / Referrer / Permissions / HSTS / DNS-prefetch — no `script-src` / `connect-src`). CSP blocking could only come from the edge/proxy/CDN. An edge CSP that blocks inline scripts would disable **all** tracking (every init is `dangerouslySetInnerHTML`). **UNABLE TO VERIFY** deployed edge CSP.
- **`Referrer-Policy: strict-origin-when-cross-origin`** (next.config.ts:41): cross-origin referer is origin-only, so Meta receives `https://site` rather than the full URL — affects referrer detail, not event presence.
- **Lazy-loading**: the fbq stub is synchronous, so events fired before the network tag loads are buffered and drained by `flushQueue` once fbq is defined — no loss, **except** race B above.
- **Hydration**: effects re-run on the client after SSR. A production build has no StrictMode double-invoke; dev StrictMode double-runs effects → double `trackEvent` → double mirror (non-Purchase events produce two snapshots; Purchase is still deduped by the shared `purchase_` id). Dev-only.
- **Duplicate suppression**: thank-you `sessionStorage` guard; the Purchase instant-mode gate; `flushQueue` drains once. There is **no browser-stage dedup for non-Purchase events** — an SPA remount of a product page fires a new ViewContent, a double-click on Add-to-Cart fires a new AddToCart.

---

## 15. Integrated runtime trace

```
[SSR]  layout.tsx → getStorefrontConfigServer() (ISR 60s)
         → <script id="__INITIAL_CONFIG__"> JSON

[Browser hydrate]
  StorefrontConfigProvider → config = initialConfig || __INITIAL_CONFIG__ || DEFAULT
  <TrackingScripts/> mount (before body children)
    useEffect#1 → setPixelIds(metaId, tiktok) → _metaId/_tiktok set → flushQueue()
    useEffect#2 → setTrackingConfig(purchaseModes)
    useEffect#3 → syncContext() → POST /api/tracking/context
                     (ctxId, identifiers{fbp,fbc,_ga,gclid,ttclid,_ttp}, url, referrer)
  lazyOnload inline script (idle, after hydration):
    define fbq stub → inject fbevents.js            [network: third-party]
    fbq('init', metaId); fbq('track','PageView')
    ttq.load; ttq.page()
    gtag define + config
    window.__flushTrackingQueue()
  (if hasAny is false → return null → no pixel at all)

[any route mount → trackEvent]
    resolvedEventId = (Purchase) ? purchase_{orderId} : Date.now()-rand
    fbq('track', E, data, {eventID})          → Meta beacon (third-party, ad-blockable)
    ttq.track / gtag                          → other providers
    fetch /api/tracking/events (mirror, keepalive) → backend capture → outbox → dispatcher → CAPI → Meta

[thank-you]
    Purchase effect (instant mode only):
      order present? (else return)  →  sessionStorage guard  →  fireMeta/fireTiktok
      trackEvent('Purchase', sharedData, sharedUserData, 'purchase_' + order.id)
         fbq Purchase + gtag + mirror /api/tracking/events  (DEDUPED vs server snapshot)
      syncContext()  ← AFTER Purchase
      sessionStorage.setItem(guard)
```

---

## 16. Verified cause matrix — why a browser event is missing while server CAPI is present

| # | Cause | Evidence | Browser leg lost? | CAPI survives? | Confidence |
|---|---|---|---|---|---|
| C1 | Ad blocker / edge CSP blocks third-party facebook+gtag hosts | TrackingScripts external injection; mirror is same-origin `/api` (next.config rewrite) | Pixel/gtag events | **Yes** (same-origin mirror) | High (for ad block) |
| C2 | Validated purchase mode (browser deliberately does not fire) | mode gate in `trackEvent` + ThankYouContent | Pixel Purchase | Yes (server validated capture) | High |
| C3 | First-load `_fbp` absent (Meta writes it after our sync) | code timing (tracking-client / fbevents.js) | match-key only; event still fires | Yes | High |
| C4 | Queue-drop race (single provider, pre-script window) | `flushQueue` guard (tracking.ts:56-70) | Pixel event(s) | Yes (mirror) | Low–Medium |
| C5 | SPA route change → no new Meta PageView | PageView fires once per hard load | new-route PageView | n/a (PageView not CAPI) | High |
| C6 | Deep-link to `/thank-you` with no prior context sync | sync order (ThankYouContent:104 vs :107) | CAPI match keys (quality, not presence) | Yes, but degraded | Medium |
| C7 | Dev StrictMode double effects | React dev behavior | duplicate mirror (non-Purchase) | duplicate snapshots | Dev-only |
| C8 | Thank-you order object fetch fails | ThankYouContent `if(!order) return` | Pixel Purchase | Yes (transactional CAPI) | Medium (deep-link) |

---

## 17. Residual unknowns (runtime-live only)

| Item | Status |
|---|---|
| Actual fbq beacon payload / batching to `www.facebook.com/tr/` | **UNABLE TO VERIFY** (needs credentialed staging) |
| Events-Manager dedup KPIs (Pixel vs CAPI) | **UNABLE TO VERIFY** |
| Browser Test-Events tool delivery | **UNABLE TO VERIFY** |
| Edge/CDN CSP and ad-block rates in production | **UNABLE TO VERIFY** |
| Real conversion attribution / EMQ outcomes | **UNABLE TO VERIFY** |

---

## 18. Credentialed follow-up (NOT executed)

To convert the UNABLE TO VERIFY items into evidence, a staging run needs:
- a runnable storefront + backend + Redis + Postgres, a non-production Meta pixel + access token;
- browser console + network capture for `/tr/` beacons, `fbevents.js`, and the mirror `/api/tracking/events`;
- simulated paths: first visit, deep-link to `/thank-you`, SPA route change, ad blocker on, strict edge CSP, validated vs instant mode;
- `_fbp` cookie evolution and the first/second-page `TrackingContext` rows.

---

**Nothing above was fixed or changed.** This is the Phase-2A evidence baseline. Next per the architect: Phase-2B (Meta Documentation Compliance & Optimization Audit) using this plus the Discovery report as the verified baseline.
