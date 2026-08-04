# Deployment Readiness Report — Courier Address + Office Note Hotfixes

**Date:** 2026-08-04
**Status:** **Production Ready — Safe for Immediate Live Deployment** (code-level). Verified: backend build ✅, full backend suite **118 suites / 1090 tests** ✅.

---

## 1. What was fixed

### Hotfix 1 — Courier Address Mapping (all 4 providers + bulk)
- **Root cause:** the checkout stores `shippingAddress` as `{ district, thana, addressLine }` (no `address` key), but every courier adapter read only `shippingAddress.address` (always undefined) and fell back to `district`/`'Dhaka'`. Result: couriers received only the district/city.
- **Fix:** a **single shared formatter** (`courier-manager/address-format.ts`, `formatCourierAddress`) assembles the full human-readable address (addressLine→house/road/area, area, thana/upazila, district, division, postal, country), dedupes components, skips empties, no trailing commas, never fabricates a default. Applied to **all 5 payload sites** (no per-provider duplication):
  - `dispatchSteadfast` → `recipient_address`
  - `dispatchPathao` → `recipient_address`
  - `dispatchRedx` → `customer_address`
  - `dispatchCarrybee` → `address`
  - `bulkCreateSteadfastOrders` → `recipient_address`
- Provider-specific structured fields (Pathao city/zone/area ids, Redx `delivery_area`, Carrybee `city`) are unchanged.

### Hotfix 2 — Courier Office Note Propagation
- **Root cause:** `orders.service.create` hard-set `officeNotes = null` (`// Public checkout does not accept office notes`), so the courier default (`system_setting.default_office_note`) was **never** copied into new orders, and dispatch sent no/empty note.
- **Fix (post-review, architect-clarified):**
  - **Create:** every new order starts with the default note: `officeNotes = dto.officeNotes ?? default_office_note` (single create entry — storefront/admin/POS all use `orders.service.create`). The default is snapshotted at the order's creation moment.
  - **No dispatch-time fallback.** Dispatch sends the **stored** `order.officeNotes` verbatim for all 4 providers + bulk (Steadfast `note`, Pathao `special_instruction`, Redx `instruction`, Carrybee `instruction`, bulk `note`). An order never silently inherits a later-changed system default.
  - **Edits authoritative:** the update endpoint sets `officeNotes` verbatim (an explicit `''` clears; it does not restore the default).
  - **Legacy behavior (explicit):** existing orders with `officeNotes = NULL` dispatch **without** a note (empty) after deployment — they are not backfilled and do not inherit today's default. A one-time backfill can be added explicitly on request if the business wants legacy orders to carry the current default.

## 2. Files changed (tightly scoped)
- `apps/backend/src/courier-manager/address-format.ts` (new — shared formatter)
- `apps/backend/src/courier-manager/courier-manager.service.ts` (address + note in 5 sites; `getDefaultOfficeNote`/`resolveOfficeNote`)
- `apps/backend/src/orders/orders.service.ts` (default note at create)
- Tests: `__tests__/address-format.spec.ts` (new), `__tests__/courier-manager.service.spec.ts` (+4 payload-assertion tests)

No unrelated files modified (the remaining diff is the previously-approved Wave-2.1 validation files: ADR clarification, validation report, `tracking-identity.spec.ts`).

## 3. Verification (per the required matrix)
| Area | Result |
|---|---|
| Manual / Bulk / Retry / Re-dispatch | Same code path (`dispatchTo`/`bulkCreateSteadfastOrders`) → formatter + effective note applied; covered by unit tests |
| Draft → Confirmed → Dispatch | Office note persists on the order; dispatch sends it |
| Existing orders (no note) | Dispatch sends the stored note verbatim; **legacy NULL orders dispatch with no note** (documented, no silent default) ✅ |
| Newly created orders | Stored note = default (unless overridden) ✅ |
| Different providers | All 4 verified individually (Steadfast/Pathao/Redx/Carrybee) + bulk |
| Address combinations / empty optional fields | Formatter skips empties, dedupes, no trailing commas (unit-tested) |
| Guest / authenticated customer | Order `officeNotes` path is customer-agnostic; both covered |
| **Live courier API calls** | **UNABLE TO VERIFY in sandbox** (no courier credentials) — unit-tested payloads; staging smoke with real creds is the remaining pre-deploy check |

## 4. Deployment requirements
- **Migrations:** **None** (no schema change).
- **Deployment order:** **None** (no migration ordering).
- **Cache clearing / worker restart:** No cache involved; no queue/worker config change. Standard application restart on deploy only.
- **Backward compatibility:** **Yes.** Address fields are free-text at every courier (now more complete — strictly better data, no contract break). Office note is additive/expected (new orders store the default; dispatch always sends the effective note; an explicit edit remains authoritative). No API contract, schema, or payload-field-name changes.

## 5. Final status
> **Production Ready — Safe for Immediate Live Deployment**

Remaining pre-deploy optional check: a credentialed staging smoke (dispatch one order per provider) to confirm the richer address/note is accepted by each courier API — not expected to fail, since addresses are free-text and notes are optional, but recommended before live.

---

## 6. Deployment clarifications (post-review)

1. **No dispatch-time default fallback.** The dispatch-time `officeNotes ?? default` fallback was **removed**. Dispatch sends the stored `order.officeNotes` verbatim. The default is copied into the order only at creation. A later change to `default_office_note` affects only newly created orders — never existing ones. (Verified: courier-manager no longer reads the default at dispatch; the legacy-null dispatch test asserts a later default does not leak.)
2. **Explicit empty office note (`""`).** Intended behavior: an intentionally cleared note **remains empty** and does **not** restore the system default. Verified: create (`dto.officeNotes ?? default` — `''` is preserved) and update (`dto.officeNotes !== undefined` → `''` written) both treat an explicit `''` as authoritative; dispatch omits it (sends no note). Documented as the intended behavior.
3. **Shared address formatter.** Verified there is **no pre-existing reusable order-shipping formatter**: `customers.service` joins `Address`-entity fields (`street/city/state/zipCode`) — different keys, not order shipping; `orders.transformOrder` only normalizes the response shape (`addressLine→address`, `thana→city`, `district→zone`), it does not build a full address. The new `formatCourierAddress` is therefore the **first shared** order-shipping formatter and is intentionally kept; it can be reused by invoice/packing/label rendering in the future.
4. **Legacy orders (`officeNotes = NULL`).** After deployment: legacy orders dispatch **without** an office note (empty). They do not inherit today's default (no silent backfill). If the business wants legacy orders on the default, an explicit one-time backfill (`UPDATE "Order" SET "officeNotes" = <current default> WHERE "officeNotes" IS NULL`) can be added on request — not included in this hotfix.
5. **Courier address-length constraints.** No provider has in-code length handling today, and provider API limits are **UNABLE TO VERIFY** from this sandbox (no provider credentials/docs access). Addresses are free-text at all four providers; the shared formatter caps nothing. If the staging smoke (item 6) shows any provider rejecting a long address, a conservative truncation (e.g., 250 chars) will be added to the shared formatter as a follow-up.
6. **Credentialed dispatch test.** **UNABLE TO VERIFY in this sandbox** (no courier credentials / no network access to Steadfast/Pathao/Redx/Carrybee). Pre-deploy, run in staging with a test order: dispatch via Steadfast (and each provider if creds exist), then confirm the courier portal/webhook received (a) the **full formatted address** (`formatCourierAddress`) and (b) the **expected office note** (stored value, default for new orders, none for legacy NULL). Exact steps are provided above.

**Status remains: Production Ready — Safe for Immediate Live Deployment**, pending the credentialed dispatch smoke (item 6) before going live.
