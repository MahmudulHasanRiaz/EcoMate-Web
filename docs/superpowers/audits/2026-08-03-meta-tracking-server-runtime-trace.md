# EcoMate Meta Tracking — Phase-2A.5: Server Runtime Execution Trace (Purchase)

**Phase-2A.5 — Final runtime evidence report. Evidence only. No fixes, no optimization, no Meta-documentation comparison.**
**Date:** 2026-08-03
**Branch:** `main` tip `19382d51` (worktree `peaceful-leavitt-47d1cd`)
**Scope:** one Purchase event traced through the entire backend runtime, stage by stage, with the exact input / output / mutated fields / event_id / external_id / fbp / fbc / timestamps / config at every stage. Followed by the retry, permanent-failure, DEAD, and replay runtime traces.

## 0. Traced event (fixed throughout)

```text
order.id          = "ord_0001"
ctxId             = "abc_12345"          (Order.trackingSessionId)
eventId           = purchase_ord_0001
eventType         = Purchase
actionSource      = website               (salesChannel "WEBSITE")
eventTime         = BigInt(order.createdAt epoch seconds) ≈ 1 720 864 000
order.total       = 3000 BDT              (2×1500 + 100 shipping − 100 flat discount)
content_ids       = ["p1"]
contents          = [{ id:"p1", quantity:2, item_price:500 }]
num_items         = 2
payload.orderId   = "ord_0001"
customer          = { email:"rahim@example.com", phone:"01720000000",
                      firstName:"Rahim", lastName:undefined, city:"Dhaka", country:"BD" }

TrackingContext (ctxId "abc_12345") exists:
  externalId = "41974e11-…"   (server crypto.randomUUID(), set at context create)
  ip = "103.1.2.3", userAgent = "Mozilla/5.0 …",
  url = "https://shop/checkout/thank-you",
  identifiers.meta  = { fbp:{value:"fb.1.1720400000000.1234567890"},
                        fbc:{value:"fb.1.1719999000000.9876543210"} },
  identifiers.google = { gaClientId:{value:"1234567890.abcdef"} },
  identifiers.tiktok = { ttclid:{value:"ttclid_xyz"} }
```

Timestamps: `T0` = order-request/capture; `T1` = relay claim+enqueue (≈ T0+1 s poll); `T2` = dispatch start; `T3` = provider send; `T4` = terminal.

Enabled providers in `configSnapshot.enabledProviders`: `["meta","tiktok"]` (both setting flags true; GA4 not added because `GA_MEASUREMENT_ID`/`GA_API_SECRET` absent; google_ads not added because `GA_ADS_CONVERSION_ID` absent). Purchase mode `instant`; validated_status `Delivered`.

---

## 1. HTTP request

```text
method  POST /orders
path    /orders
body    { items:[{productId:"p1", variantId:null, quantity:2, price:500}],
          guestName:"Rahim", guestPhone:"01720000000", guestEmail:"rahim@example.com",
          shippingAddress:{city:"Dhaka"}, district:"Dhaka", thana:"…",
          shippingCharge:100, discount:100, discountType:"flat",
          salesChannel:"WEBSITE", paymentOptionType:"CASH_ON_DELIVERY",
          trackingSessionId:"abc_12345" }
```
- Headers: `user-agent` (client UA), client IP available via `req.ip`. The tracking **context** ip/UA are set at `/tracking/context`, not here.
- Input to stage 2: the raw HTTP body + `req` + optional `user`.

Evidence: [orders.controller.ts:37 `@Controller('orders')`, :100 `@Post() create(...)`]; checkout sends `trackingSessionId: getOrCreateCtxId()` (checkout/page.tsx:679).

## 2. Controller

`OrdersController.create(dto, req, user)` — thin. Delegates to `ordersService.create(...)` with the DTO, `req`, `user`. No tracking logic in the controller (kept thin per project rule).

- Input: validated DTO + request context.
- Output: delegated (async) to the service.
- Mutated fields: none at this layer.

Evidence: orders.controller.ts:100-105.

## 3. DTO

`CreateOrderDto` (class-validator). Tracking-relevant fields:

| field | decorator | value in trace |
|---|---|---|
| `trackingSessionId` | `@IsOptional() @IsString()` | `"abc_12345"` (order.dto.ts:57) |
| `salesChannel` | `@IsEnum(SalesChannel)` | `WEBSITE` |
| `items` | `@IsArray() @ValidateNested({each:true})` | `[{productId,quantity,price}]` |
| `guestName/guestPhone/guestEmail` | `@IsOptional() @IsString()` / `@IsEmail()` | Rahim / 01720000000 / rahim@example.com |
| `shippingAddress/district/thana` | `@IsOptional()` | Dhaka |

- Input: raw body. Output: typed DTO. Mutated: none.

Evidence: order.dto.ts:27-58.

## 4. Validation

Global `ValidationPipe` (whitelist) runs `class-validator` on `CreateOrderDto`. Passes.

- `trackingSessionId` accepted as a string; a missing/malformed value is `null`, never an error — no tracking-specific rejection.
- Input: DTO. Output: validated, normalized DTO.

Evidence: order.dto.ts decorators; standard Nest global ValidationPipe on the app.

## 5. TrackingCaptureService.capture(input, tx)

`firePurchaseInstant` runs inside the order `$transaction` (order.service) and calls `trackingCapture.capture(input, tx)` with the **same `tx`** — the snapshot + outbox are written atomically with the order.

`input` (orders.service.ts:3218-3250):

```text
eventId     "purchase_ord_0001"
eventType   "Purchase"
orderId     "ord_0001"
ctxId       "abc_12345"
eventTime   1720864000
actionSource "website"
payload     { value:3000, currency:"BDT", content_ids:["p1"], content_type:"product",
              contents:[{id:"p1",quantity:2,item_price:500}], num_items:2,
              orderId:"ord_0001",
              customer:{ email:"rahim@example.com", phone:"01720000000",
                         firstName:"Rahim", city:"Dhaka", country:"BD" } }
configSnapshot (from buildConfigSnapshot, computed just before):
              { enabledProviders:["meta","tiktok"], normalizerVersion:1,
                capturedAt:"<T0 ISO>", purchaseModes:{meta:"instant",tiktok:"instant"},
                validatedStatuses:{meta:"Delivered",tiktok:"Delivered"} }
```

- Output (this event): `{ status:"CAPTURED", snapshotId:"S_1" }` (or `{ status:"DEDUPED" }` on an `eventId` collision — never throws).
- Mutated: nothing yet (the write happens in stage 6/7).

Evidence: tracking-capture.service.ts:46-50 (tx pass-through), 106-110 (own `$transaction` when no tx); orders.service.ts:3216 + 3218.

## 6. TrackingSnapshot creation (same tx)

- `trackingSnapshot.createMany({ data:[…], skipDuplicates:true })` → Prisma `INSERT … ON CONFLICT (eventId) DO NOTHING`; returns `count`.
- count=1 here → snapshot inserted. count=0 would mean the `eventId` already exists → `{ status:"DEDUPED" }`, no outbox.
- Snapshot is read back by `eventId` to obtain its `id` (createMany does not return ids).

Row written:

```text
TrackingSnapshot {
  id:            "S_1"              (uuid PK)
  eventId:       "purchase_ord_0001"
  eventType:     "Purchase"
  orderId:       "ord_0001"
  ctxId:         "abc_12345"
  eventTime:     BigInt(1720864000)
  actionSource:  "website"
  schemaVersion: 1
  payload:       { value:3000, currency:"BDT", content_ids:["p1"], contents:[…],
                   num_items:2, orderId:"ord_0001",
                   customer:{ email, phone, firstName, city, country } }   // RAW, unhashed
  createdAt:     T0
}
```

- event_id: `purchase_ord_0001`. external_id: **not stored here** (lives only on TrackingContext). fbp/fbc: not stored here.

Evidence: tracking-capture.service.ts:53-83; payload raw by design.

## 7. TrackingOutbox creation (same tx)

```text
TrackingOutbox {
  id:            "O_1"
  snapshotId:    "S_1"                (UNIQUE — one outbox per snapshot)
  configSnapshot { enabledProviders:["meta","tiktok"], normalizerVersion:1,
                   capturedAt, purchaseModes, validatedStatuses }   // capture-time config
  status         "PENDING"
  priority       10                   (HIGH_PRIORITY for Purchase/Refund, else 0)
  attemptCount   0
  nextAttemptAt  T0
  lockedAt       null, lockedBy null
  createdAt      T0
}
```

- `skipDuplicates:true` → idempotent outbox insert. Returns `{ status:"CAPTURED", snapshotId:"S_1" }`.
- Commit: the whole `$transaction` (order + snapshot + outbox) commits atomically; the business txn cannot be rolled back by tracking.

Evidence: tracking-capture.service.ts:89-108; priority constants :30-32.

## 8. Relay claim

`OutboxRelayService` interval poll (1 s) — gated by `tracking_relay_enabled === "true"` (OFF by default) and `nextAttemptAt <= now`:

```sql
UPDATE "TrackingOutbox" SET status='CLAIMED', "lockedAt"=now(), "lockedBy"=$instance
WHERE id IN ( SELECT id FROM "TrackingOutbox"
              WHERE status='PENDING' AND "nextAttemptAt"<=now() AND "lockedAt" IS NULL
              ORDER BY priority DESC, "nextAttemptAt" ASC LIMIT $batch
              FOR UPDATE SKIP LOCKED )
RETURNING id, "snapshotId", "attemptCount"
```

- Input: none beyond the claim SQL.
- Output: `{ id:"O_1", snapshotId:"S_1", attemptCount:0 }`.
- Mutated: `status="CLAIMED"`, `lockedAt=T1`, `lockedBy="relay-1"`. Double-claim impossible (SKIP LOCKED); priority 10 claims Purchase ahead of browser events.

Evidence: outbox-relay.service.ts:83-101.

## 9. BullMQ enqueue

```ts
trackingQueue.add("send", { snapshotId:"S_1", outboxId:"O_1", attemptCount:0 },
  { jobId:"O_1-0",                  // ${outboxId}-${attemptCount} — no colon (prod fix 05152596)
    attempts:3, backoff:{ type:"exponential", delay:2000 },
    removeOnComplete:100, removeOnFail:50 })
```

- Input: the claimed row. Output: job enqueued (or, on failure, `releaseLock` → PENDING + `attemptCount++` + backoff + clear lock).
- Mutated on enqueue failure only.

Evidence: outbox-relay.service.ts:104-125, 183-204.

## 10. Dispatcher execution

`TrackingDispatcherProcessor.process` → `dispatcher.process(job)` → `run()`.

- Load `TrackingSnapshot` by `snapshotId="S_1"` (present → live path; the replay-archive is the fallback after retention purge).
- Load `TrackingOutbox` by `outboxId="O_1"`. **Early-return if terminal** (`SENT`/`DEAD`).
- Source: `{ snapshotId:"S_1", eventId:"purchase_ord_0001", orderId:"ord_0001", ctxId:"abc_12345" }`.
- `config = outbox.configSnapshot` → `enabledProviders=["meta","tiktok"]`.
- `buildAdapterRegistry()` (idempotent module map); `serverOnly = (actionSource === "physical_store")` → false (website).
- Eligible work-set: `meta.supports("Purchase",{serverOnly})` → true; `tiktok` → true. Both eligible.
- `Promise.allSettled([meta, tiktok])` — provider independence; one failure never blocks the other.

Evidence: tracking-dispatcher.service.ts:108-211 (run), :44 (WORK_SET), :189 (serverOnly).

## 11. Config resolution

`buildCfg(provider)` (per provider):

```text
meta:   pixelId     = settings.get("tracking_meta_pixel_id",     "META_PIXEL_ID")
        accessToken = settings.get("tracking_meta_access_token", "META_ACCESS_TOKEN")   // SECRET
        testEventCode = settings.getTestEventCode("meta")
                       → null unless tracking_meta_test_mode === "true"   // gated
tiktok: pixelCode / accessToken / testEventCode  (analogous, tracking_tiktok_*)
ga4/google_ads: env-only (GA_MEASUREMENT_ID/GA_API_SECRET / GA_ADS_CONVERSION_ID/LABEL) — not present here
```

- Input: provider name + settings/env. Output: `ProviderConfig`. Mutated: none.

Evidence: tracking-settings.service.ts:16-41; tracking-dispatcher.service.ts:712-750.

## 12. Context resolution

`trackingContext.getByCtxId("abc_12345")` → row → `buildContextView`:

```text
externalId : "41974e11-…"            (server-generated uuid, per journey — G3)
ip         : "103.1.2.3"
userAgent  : "Mozilla/5.0 …"
url        : "https://shop/checkout/thank-you"
referrer   : undefined
fbp        : "fb.1.1720400000000.1234567890"   (identifiers.meta.fbp.value)
fbc        : "fb.1.1719999000000.9876543210"   (identifiers.meta.fbc.value)
gaClientId : "1234567890.abcdef"               (identifiers.google.gaClientId.value)
gclid      : undefined
ttclid     : "ttclid_xyz"
```

- event_id / external_id / fbp / fbc now all in view. Mutated: none.

Evidence: tracking-dispatcher.service.ts:753-768 (buildContextView), :165 (getByCtxId).

## 13. TrackingNormalizer

Version 1, applied inside the adapter's `build()`. For this Purchase:

```
hashEmail("rahim@example.com")  → sha256(trim+lowercase); not synthetic → hash
hashPhone("01720000000","BD"): digits "01720000000" → strip leading 0 → "1720000000"
    (10 digits, BD) → sha256("8801720000000")
hashName("Rahim")  → sha256("rahim")
hashCity("Dhaka")  → sha256("dhaka")
hashCountry("BD")  → sha256("bd")
zip / state: undefined (no field)
hashExternalId("41974e11-…") → sha256(lowercased)
fbp / fbc / client_ip / client_ua: passed RAW (never hashed)
```

- Single hashing path; no adapter hashes inline. Mutated: none (pure function).

Evidence: tracking.normalizer.ts:16-122 (hashPhone BD rule 36-51, isSyntheticEmail 94-104).

## 14. MetaAdapter.build() → ProviderPayload

```text
eventType = "Purchase" ; isRefund=false → eventName = "Purchase"
eventId   = resolveEventId → "purchase_ord_0001"
value     = 3000 (not negated)
user_data = { em:<hashEmail>, ph:<hashPhone>, fn:<hash "rahim">, ln:undefined,
              ct:<hash "dhaka">, st:undefined, cn:<hash "bd">, zp:undefined,
              external_id:<hash(externalId)>,
              fbp:"fb.1.1720400000000.1234567890", fbc:"fb.1.1719999000000.9876543210",
              client_ip_address:"103.1.2.3", client_user_agent:"Mozilla/5.0 …" }
custom_data = { value:3000, currency:"BDT", content_ids:["p1"], content_type:"product",
                contents:[{id:"p1",quantity:2,item_price:500}], num_items:2, order_id:"ord_0001" }
action_source     = "website"
event_source_url  = "https://shop/checkout/thank-you"
event_time        = 1720864000
```

- Input: snapshot payload + context view + normalizer. Output: `ProviderPayload` (or `null` → dispatch `SKIPPED`). Mutated: none.

Evidence: meta.adapter.ts:38-106.

## 15. MetaAdapter.send() — dispatch/HTTP request creation

```text
url = `https://graph.facebook.com/v22.0/{pixelId}/events?access_token={accessToken}`
body = {
  data: [ { event_name:"Purchase", event_id:"purchase_ord_0001", event_time:1720864000,
            action_source:"website", event_source_url:"…",
            user_data:{…}, custom_data:{…} } ],
  ...(testEventCode ? { test_event_code:… } : {})        // omitted (no test mode)
}
fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
             body:JSON.stringify(body), signal:AbortSignal.timeout(1500) })
```

- Single event per request (batch = 1). Timeout 1500 ms.
- **Observation (already logged):** the Meta access token travels in the URL query string (`?access_token=`) → visible to infra/proxy access logs.

Evidence: meta.adapter.ts:119-145.

## 16. HTTP request creation (on the wire)

The `fetch` above is the actual outbound HTTP request to `graph.facebook.com/v22.0/…/events`. Request method POST, JSON body, `access_token` query param, 1500 ms abort. No batching, no retry inside the adapter — retries are the dispatcher/outbox concern.

Evidence: meta.adapter.ts:140-146.

## 17. Response classification → DispatchResult

- HTTP 2xx (`response.ok`) → `{ ok:true, retryable:false, providerEventId:"purchase_ord_0001", httpStatus:200, rawResponse:"<body, ≤500 chars>" }`.
- `429` or `>=500` → `retryable:true`.
- other `4xx` → `retryable:false` (permanent).
- network error / AbortSignal timeout → `retryable:true`.
- `rawResponse` always truncated to 500 chars.

Evidence: meta.adapter.ts:147-174.

## 18. Dispatch status transitions (per provider)

`ensureDispatchRow` (find-or-create under `@@unique([snapshotId, provider])`) creates the row:

```text
New row (meta): id "D_1", snapshotId "S_1", eventId "purchase_ord_0001",
  orderId "ord_0001", ctxId "abc_12345", queueJobId "O_1-0",
  provider "meta", status PENDING, providerEventId "purchase_ord_0001",
  attemptCount 0, adapterVersion 1, providerApiVersion "v22.0",
  payloadVersion 1, normalizerVersion 1, createdAt/updatedAt T2
```

Then `dispatchProvider`: status → `SENDING` → `build()` → `send()` → `classify()`:

```text
status → SENT, attemptCount 0→1, providerEventId unchanged, httpStatus 200,
responseBody "<200 body, ≤500>", adapterVersion 1, providerApiVersion "v22.0"
```

`TrackingDispatchEvent` rows appended for each transition: `PENDING→SENDING` (attempt 0) and `SENDING→SENT` (attempt 1). TikTok runs in parallel with its own row.

Evidence: tracking-dispatcher.service.ts:293-400 (dispatchProvider), :413-461 (ensureDispatchRow), :770-793 (appendEvent).

## 19. Outbox transitions

`advanceOutbox` — `statusByProvider = { meta:"SENT", tiktok:"SENT" }`:
- every status in `TERMINAL_SUCCESS = {SENT, SKIPPED, DEDUPED}` → **outbox `SENT`**, `dispatchedAt=T4`, append event `CLAIMED→SENT` ("all providers dispatched").
- Not DEAD → no DLQ mirror, no replay archive.

Mutated: `TrackingOutbox.status = "SENT"`, `dispatchedAt = T4`.

Evidence: tracking-dispatcher.service.ts:501-528, :595-628.

## 20. Monitoring updates

The aggregate queries pick this row up:
- `getVolumeByEventType` → `Purchase` += 1.
- `getDispatchFunnel("meta")` → `sent` += 1.
- `getFreshness` → one capture→dispatch sample: `dispatchedAt(T4) − createdAt(T0)`.
- `getRetryHistogram` → attemptCount 1 at attempt level 1.
- `getDedupKeyUsage` → `event_id` += 1; `external_id` remains 0 (`payload.externalId` is never written — Discovery G7).

Evidence: monitoring.service.ts:88-222.

---

## 21. Retry runtime trace (retryable 5xx)

1. `dispatchProvider` send returns `{ ok:false, retryable:true, httpStatus:500, raw:"…" }` → `classify` → **`RETRY`**.
2. `TrackingDispatch` → status `RETRY`, `attemptCount` 0→1, `httpStatus` 500, `errorMsg`; `providerEventId` unchanged.
3. `TrackingDispatchEvent` `SENDING→RETRY`.
4. `advanceOutbox`: statuses `["RETRY"]` — not all terminal, no `FAILED/DEAD` → **outbox `CLAIMED→PENDING`**, `attemptCount` 0→1, `nextAttemptAt = T + 1m` (backoff step 1), **`lockedAt`/`lockedBy` cleared**, `lastError` set.
5. `run()` returns **normally** — no throw — so the BullMQ job completes as a success. **BullMQ `attempts:3` is not exercised for provider 5xx.**
6. The relay re-claims the row when `nextAttemptAt <= now` (jobId `O_1-1`) and the dispatcher re-runs; the dispatch row is in `WORK_SET` (`RETRY`) → re-send. Cadence from the outbox backoff schedule `1m → 10m → 1h → 6h → 24h`; `outbox.attemptCount` grows 1→5. The failure that would push `attemptCount > 5` → **DEAD** (stage 23).
7. Each attempt reuses `providerEventId = "purchase_ord_0001"` → provider-side dedup absorbs duplicate deliveries.

Evidence: tracking-dispatcher.service.ts:404-407 (classify), :554-591 (advanceOutbox retry path); outbox-relay.service.ts:31-46 (backoff), :83-125 (re-claim).

**Variant — unexpected exception (not a provider response):** if `run()` throws (missing snapshot/outbox, DB error), `process()` → `releaseStuckOutbox` (PENDING + `attemptCount++` + backoff + clear lock, only if the outbox is `CLAIMED`) → **rethrow** → BullMQ `attempts:3, exponential 2s` re-invokes `process` with the same `jobId`. Up to 3 transport attempts per claim; if all throw, the job fails and the relay re-claims on the DB schedule.

Evidence: tracking-dispatcher.service.ts:98-105 (process), :260-279 (releaseStuckOutbox).

## 22. Permanent-failure runtime trace (400)

1. `send` → `{ ok:false, retryable:false, httpStatus:400, rawResponse:"<bad payload>" }` → `classify` → **`FAILED`**.
2. `TrackingDispatch` → status `FAILED`, `attemptCount` +1, `errorMsg`, identity unchanged.
3. `TrackingDispatchEvent` `SENDING→FAILED`.
4. `advanceOutbox`: statuses include `FAILED`; `hasPermanentFailure = true`; `successPolicy` = `ALL_SENT` → **DEAD** branch.
5. `terminalOutbox`: `TrackingOutbox.status = DEAD`, `lastError` set; event appended (`…→DEAD`, "ALL_SENT policy unmet: …").
6. Side-effects at DEAD (best-effort, failures swallowed):
   - `mirrorDeadOutbox` → `tracking-dlq` queue add `{outboxId, snapshotId, provider, errorMsg}` with `jobId "O_1-3-dlq"` (mirror only; no worker).
   - `archiveDeadOutbox` → `replay.archive(...)` → `TrackingReplayArchive` upsert: `archivedPayload` = snapshot payload with email/phone replaced by SHA-256 hashes (PII-stripped), `configSnapshot`, `versions = { schemaVersion:1, payloadVersion:1, normalizerVersion:1, adapterVersion:1, providerApiVersion:"v22.0", providers:{meta:{…}} }`.
7. A sibling provider already `SENT` (e.g. tiktok) stays `SENT`; only the permanent failure under `ALL_SENT` DEADs the outbox.

Evidence: tracking-dispatcher.service.ts:539-551 (hasPermanentFailure), :594-687 (terminalOutbox → mirror/archive).

**TikTok variant:** HTTP 200 with a non-zero business body `code` → failure; `retryable` only for `code ∈ {40011, 40012}`, otherwise permanent `FAILED`.

## 23. DEAD runtime trace

Durable state after the outbox reaches DEAD:

```text
TrackingOutbox:       status=DEAD, lastError, attemptCount
TrackingReplayArchive: one row — PII-stripped payload + configSnapshot + pinned versions (snapshotId UNIQUE)
tracking-dlq queue:    one mirror job (jobId "O_1-<n>-dlq", removeOnComplete:0)
```

- **Reconciler** and the relay do nothing forward from DEAD on their own.
- **Only ReplayService** returns it to the pipeline (stage 24).
- **RetentionCleanupService** purges it at 30 d after terminal (`status in (SENT, DEAD)` and `dispatchedAt < now − 30d`), along with its dispatch-events.
- **Monitoring** `deadStats.deadCount` counts the DB row (authoritative DLQ-depth KPI); the `tracking-dlq` queue depth is secondary.

Evidence: dlq.service.ts:46-75; retention-cleanup.service.ts:184-224; monitoring.service.ts getDeadStats.

## 24. Replay runtime trace

1. Admin `POST /tracking/admin/replay/:snapshotId` (`S_1`) → `ReplayService.replay("S_1")`.
2. Load `archive` + `outbox` in parallel. If `outbox.status !== "DEAD"` → warn and **no-op** (only DEAD rows replay).
3. Load the live snapshot (fallback source; the archive is preferred and survives retention).
4. `versions = archive?.versions`; `enabledProviders = outbox.configSnapshot.enabledProviders`.
5. `pinAdapters(enabledProviders, versions)`: `buildAdapterRegistry()`; for each provider `getAdapter(provider, recordedVersion)`; if the recorded version is retired → current adapter + version-mismatch `warn` (auditable).
6. Reset outbox: `status=PENDING, attemptCount=0, nextAttemptAt=now, lockedAt/lockedBy=null`.
7. Append `TrackingDispatchEvent` `DEAD→PENDING` with `queueJobId "O_1:replay:0"` (audit marker only) and `message:"replay"`.
8. **Replay does not self-enqueue** — the relay is the sole enqueuer; its next poll claims the reset row and dispatches. The dispatcher uses the **archive payload** if the snapshot was purged (event_id preserved) or the live snapshot; the same `event_id` is reused → provider dedup absorbs it.

Evidence: replay.service.ts:93-164 (replay), :218-237 (pinAdapters).

---

## 25. Runtime observations (evidence, not action items)

1. **Retryable provider failures do NOT trigger BullMQ `attempts:3`.** The dispatcher resolves those jobs normally; retries are driven by the DB outbox schedule via the relay. BullMQ `attempts:3` covers only unexpected exceptions. (Two genuinely distinct layers: DB outbox schedule for provider retryable, BullMQ for exceptions.)
2. **`successPolicy` is `ALL_SENT` only** — `configSnapshot` never carries a successPolicy (Discovery G4), so one permanent-failed provider under ALL_SENT DEADs the outbox even when another provider SENT.
3. **`external_id` lives only on TrackingContext** — it is never written into the snapshot payload, so the monitoring `external_id` dedup metric is always 0 (Discovery G7).
4. **Meta access token travels in the Graph URL query string** (`?access_token=`) → visible to infra/proxy access logs (Discovery G10).
5. Snapshot + outbox are captured inside the order `$transaction` — capture failure can never roll back the order.
6. The dispatcher uses the **capture-time `configSnapshot`**, not live settings — a config change mid-lifecycle does not affect already-captured outboxes.

## 26. Residual unknowns (runtime-only)

| Item | Status |
|---|---|
| Actual Meta HTTP response body / dedup outcome on the wire | **UNABLE TO VERIFY** — needs a live credentialed dispatch |
| Whether `tracking_relay_enabled` is ON in the target DB | **UNABLE TO VERIFY** |
| Exact `enabledProviders`/mode/validated_status in the target tenant settings | **UNABLE TO VERIFY** |
| Live freshness/funnel/DEAD numbers | **UNABLE TO VERIFY** (monitoring reads the DB; no data view here) |

---

This is the final server-side runtime evidence baseline. **No code was modified.** Per the architect, Phase-2B (Meta Documentation Compliance & Enterprise Optimization Audit) will use the Discovery report, Phase-2A, and this trace as the verified baseline.
