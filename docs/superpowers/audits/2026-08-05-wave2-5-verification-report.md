# Wave-2.5 Verification Report — Order Payload Quality (zp/st/ln) + Replay/Retry Safety

**Date:** 2026-08-05
**Status:** Implemented + verified (builds, full suites). Not committed. Awaiting architect review.
**Depends on:** Wave-2 Audit v2 (Part C steps 4 + 7); Wave-2.1 (identity); Wave-2.4 (monitoring surfacing).

---

## 1. What was implemented

### 1.1 Address match keys on the Purchase payload (Part C step 4 — zp/st/ln)
- **Before:** order captures carried `email / phone / firstName / lastName / city / country`. Shipping `state`/`zip` (weighted Meta match keys) were dropped at capture.
- **After (`orders.service.ts` → `buildAndSendPurchaseEvent`):**
  - `state` read from `shippingAddress.state` or `shippingAddress.division` (storefront alias);
  - `zip` read from `shippingAddress.zipCode` or `shippingAddress.postalCode` (Address model + alias);
  - both added to `payload.customer` as `state` / `zip`.
  - `ln` (lastName) and `ct` (city) were already captured — now the full zp/st/ln/ct/country key set reaches Meta. Values are **anonymized at dispatch** by `TrackingNormalizer` (state/city lowercased + hashed; zip de-dashed, US ZIP+4 truncated per $4.5 rules).

### 1.2 Replay / retry safety review (Part C step 7 — payload hygiene + recovery invariants)
Verified (no code change required — the pipeline already enforces these):
- **Replay uses capture-time `configSnapshot.enabledProviders`**, so a replayed event dispatches to the same providers under the same capture policy — a replayed event can never pick up a provider that was not enabled when the order was placed (`tracking-dispatcher.service.ts`).
- **`No adapter registered for enabled provider`** → logged, provider skipped, other providers unaffected (provider-independence via `Promise.allSettled`).
- **7-day event-age guard (Decision B / R2):** events older than 7 days web / 62 days offline are DEAD'd with the reason recorded instead of being retried into a guaranteed-rejected Meta request.
- **Identity stability on replay:** `resolveForOrder` re-resolves the customer `external_id` per order at dispatch, so replayed events reuse the same dedup key (replay/dedup consistency preserved; no context rows rewritten).
- **Exactly-once re-enqueue:** replay keeps the relay as the sole enqueuer (`${outboxId}:replay:${attemptCount}` nonce job id, `message: 'replay'` audit event) — no self-enqueue race.

## 2. Files changed (Wave-2.5 scope)
- Backend: `orders/orders.service.ts` (`state`/`zip` capture, aliases) · test `src/orders/orders.service.spec.ts` (+2 tests under `buildAndSendPurchaseEvent`).
- No schema, dispatcher, adapter, or storefront changes.

## 3. Verification results
| Check | Result |
|---|---|
| Backend build (`nest build`) | pass (exit 0) |
| Backend full suite (`jest`) | **118 suites / 1118 tests pass** (orders.service.spec +2) |
| Storefront / Admin | unchanged; no regressions (43/43 storefront, tsc clean all apps) |

## 4. Backward compatibility
- Additive payload keys; existing `objectContaining` purchase assertions unaffected. Normalization rules unchanged. Replay/retry behavior unchanged — reviewed and confirmed safe.

## 5. Risks/notes
- **Shipping-field availability:** `zipCode`/`postalCode` are optional on the storefront address flow; when absent the keys simply stay undefined (no dummy values — Meta rejects fabricated payloads).
- **EMQ impact estimate:** zp/st add +0.3–0.5 per the Wave-2 audit Part C table; confirm against the Dataset Quality API after rollout (success criteria S9–S11).
- Remaining roadmap items (not in scope): phone-derived stable guest key (step 6) and the Dataset Quality API reader (Part D integration) — the monitoring surface from Wave-2.4 is ready to receive it.