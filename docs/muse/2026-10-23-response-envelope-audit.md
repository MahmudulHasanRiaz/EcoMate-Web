# Response-envelope audit — admin list consumers vs backend list endpoints

- **Date:** 2026-10-23
- **Branch:** `burndown/c-envelope-sweep` (worktree `ecomate-burndown/c-envelope-sweep`)
- **Base commit:** `e30bdf21` — `fix(accounting): return the paginated envelope from GET /financial-periods`
- **Scope:** every admin list screen / `api.ts` list method, checked against the backend `@Get` handler it calls. Contract fixes are applied at the **controller** (HTTP boundary) only; service-internal return types are unchanged. Every consumer of a changed endpoint is updated in the same commit.

## সারসংক্ষেপ (Bengali summary)

এই অডিটে অ্যাডমিন প্যানেলের প্রতিটি লিস্ট স্ক্রিন এবং তার `api.ts` মেথডকে সংশ্লিষ্ট ব্যাকএন্ড `@Get` এন্ডপয়েন্টের সাথে মিলিয়ে দেখা হয়েছে। উদ্দেশ্য ছিল response envelope-এর চুক্তি (`{ data, meta }` বনাম bare array বনাম custom object) আসলে মিলছে কি না তা যাচাই করা — কারণ TypeScript-এর টাইপ ভুল থাকলেও রানটাইমে লিস্ট খালি দেখাতে পারে।

ফলাফল: **৪টি বাস্তব মিসম্যাচ** পাওয়া গেছে এবং সবগুলো ঠিক করা হয়েছে —

1. `GET /accounts` ব্যাকএন্ড bare array ফেরাত, কিন্তু অ্যাডমিন `response.data.data` পড়ত → chart-of-accounts-এর parent picker এবং journal-entry/report-এর account select স্থায়ীভাবে খালি ছিল। এখন কন্ট্রোলারে `{ data, meta }` envelope যোগ করা হয়েছে।
2. `GET /reviews` ব্যাকএন্ড envelope ফেরাত, কিন্তু অ্যাডমিন bare array ভাবত → রিভিউ মডারেশন তালিকা কখনোই দেখাত না। এখন অ্যাডমিন consumer envelope পড়ে এবং পেজিনেটরের অনুপস্থিতিতে `perPage: 100` চায়।
3. `GET /dispatch/metrics` ব্যাকএন্ড একটি object (`{ total, byCourier, byStatus }`) ফেরাত, অ্যাডমিন array ভাবত → মেট্রিক্স কার্ড রেন্ডার হতো না। এখন টাইপ ও কম্পোনেন্ট object অনুযায়ী ঠিক করা হয়েছে।
4. অ্যাডমিন অর্ডার ফর্ম `/shipping-zones` (অস্তিত্বহীন রুট) কল করত; সঠিক রুট `/shipping/zones`। ফলে জোন-ভিত্তিক ডেলিভারি চার্জ উপেক্ষিত হয়ে ফ্ল্যাট ডিফল্টে নেমে যেত। পাথ ঠিক করা হয়েছে।

এছাড়া **C4**: `POST /accounting/payments/backfill-journals`-এর dry-run আগে প্রতিটি সারিকে মিথ্যাভাবে `skipped / dry_run` দেখাত। এখন dry-run আসল guard chain চালায় এবং সত্যিকারের ফলাফল দেয় — `would_post`, COD-guard skip, accounting-disabled, zero-amount ইত্যাদি — কিছুই লেখা বা system account তৈরি না করে। `wouldPost` কাউন্টার যোগ করা হয়েছে।

`/categories`-এর টাইপ-শুধু drift ইচ্ছাকৃতভাবে ঠিক করা হয়নি (নিচে কারণ ব্যাখ্যা করা)। বাকি সব লিস্ট সারফেস হয় ইতিমধ্যে সঠিক envelope/array/custom shape-এ আছে, নয়তো টাইপ ও রানটাইম দুই দিকেই মিলে আছে।

## Method

1. Enumerated every admin list method (`apps/admin/src/features/**/api.ts`) and every raw `apiClient.get` path used by a list screen (220 distinct GET paths across the admin app).
2. Enumerated every backend `@Get` handler (419 handlers) and read the actual `return` shape of the list handlers (service return value included — not just the controller signature).
3. Compared four things per surface: backend body shape, admin response type, the unwrap expression in the component/hook, and whether the screen renders from that value.
4. A surface is a **mismatch** only when the runtime shapes disagree (e.g. `Array.isArray(body)` is false but the consumer maps over it), or the called route does not exist.
5. Fixes: controller-level envelope where the admin convention is `{ data, meta }`; admin consumer/type/path where the backend shape is intentional. Contract tests pin the fixed HTTP shapes.

## Verdict taxonomy

| Verdict | Meaning |
| --- | --- |
| `OK — envelope` | Backend returns `{ data, meta }`; admin reads `.data` / `.meta`. |
| `OK — array` | Backend returns a bare array; admin consumes a bare array. Consistent (no envelope required). |
| `OK — custom` | Backend returns a named object (facets, flat pagination, KPI object); admin type/consumer matches. |
| `FIXED — backend` | Runtime mismatch fixed by adding the `{ data, meta }` envelope at the controller. |
| `FIXED — admin` | Runtime mismatch fixed in the admin consumer (type / unwrap / route). |
| `DRIFT — not fixed` | Type-only drift; runtime is consistent today, so changing it would be churn (documented below). |

## Inventory

### Orders, fulfilment, dispatch

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `GET /orders` | `{ data, meta }` | `data.data` + meta | OK — envelope |
| 2 | `GET /orders/staff/list` | array | array | OK — array |
| 3 | `GET /returns` | `{ data, meta }` | `data.data` | OK — envelope |
| 4 | `GET /refunds` | `{ data, meta }` | `data.data` | OK — envelope |
| 5 | `GET /shipments` | `{ data, meta }` | `data.data` | OK — envelope |
| 6 | `GET /dispatch` | `{ data, total, facets }` | same | OK — custom |
| 7 | `GET /dispatch/flagged` | array | array | OK — array |
| 8 | `GET /dispatch/metrics` | `{ total, byCourier, byStatus }` | was `Array<{courier,status,_count}>` | **FIXED — admin** |
| 9 | `GET /packing/history` | array (max 50) | array | OK — array |
| 10 | `GET /packing/locks` | array | array | OK — array |
| 11 | `GET /packing/queue` | array | array | OK — array |
| 12 | `GET /checkout-leads` | `{ data, meta }` | `data.data` | OK — envelope |

### Catalog

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 13 | `GET /products` | `{ data, meta }` | `data.data` | OK — envelope |
| 14 | `GET /categories` | array | typed `PaginatedResponse<T>` | DRIFT — not fixed |
| 15 | `GET /brands` | array | array | OK — array |
| 16 | `GET /attributes` | array | array | OK — array |
| 17 | `GET /tags` | array | array | OK — array |
| 18 | `GET /size-charts` | array | array | OK — array |
| 19 | `GET /combos` | `{ data, meta }` | `data.data` | OK — envelope |
| 20 | `GET /reviews` | `{ data, meta }` | was bare array | **FIXED — admin** |
| 21 | `GET /coupons` | array | array | OK — array |
| 22 | `GET /coupons/:id/usage` | `{ data, meta }` | `data.data` | OK — envelope |
| 23 | `GET /landing-pages` | `{ data, meta }` | `data.data` | OK — envelope |
| 24 | `GET /cms-pages` | array | array | OK — array |
| 25 | `GET /media` | `{ data, meta }` | `data.data` | OK — envelope |
| 26 | `GET /v1/feeds/config` | array | array | OK — array |
| 27 | `GET /sales-channel/sources` | array | array | OK — array |
| 28 | `GET /mobile-builder/builds` | array | array | OK — array |

### Inventory and purchasing

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 29 | `GET /inventory/logs` | `{ data, meta }` | `data.data` | OK — envelope |
| 30 | `GET /inventory/transfers` | `{ data, meta }` | `data.data` | OK — envelope |
| 31 | `GET /inventory/transfer-requests` | `{ data, meta }` | `data.data` | OK — envelope |
| 32 | `GET /inventory/stock-overview` | `{ data, meta }` | `data.data` | OK — envelope |
| 33 | `GET /inventory/physical` | array | array | OK — array |
| 34 | `GET /inventory/physical/reservations` | array | array | OK — array |
| 35 | `GET /inventory/replenishment` | array | array | OK — array |
| 36 | `GET /inventory/low-stock` | `{ count, products }` | same | OK — custom |
| 37 | `GET /inventory/valuation` | `{ items, totalValue, … }` | same | OK — custom |
| 38 | `GET /inventory/valuation/managed` | `{ items, totalValue, … }` | same | OK — custom |
| 39 | `GET /warehouses` | array | array | OK — array |
| 40 | `GET /suppliers` | array | array | OK — array |
| 41 | `GET /purchases` | `{ data, meta }` | `data.data` | OK — envelope |
| 42 | `GET /purchases/:id/grns` | array | array | OK — array |

### Customers, CRM, notifications

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 43 | `GET /customers` | `{ data, meta }` | `data.data` | OK — envelope |
| 44 | `GET /blocked-entries` | array | array | OK — array |
| 45 | `GET /referrals` | `{ data, meta }` | `data.data` | OK — envelope |
| 46 | `GET /notifications/logs` | `{ data, meta }` | `data.data` | OK — envelope |
| 47 | `GET /notifications/settings` | array | array | OK — array |

### Accounting, expenses, payments

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 48 | `GET /accounts` | was bare array | `response.data.data` | **FIXED — backend** |
| 49 | `GET /accounting/entries` | `{ data, meta }` | `data.data` | OK — envelope |
| 50 | `GET /payments` | `{ data, meta }` | `data.data` | OK — envelope |
| 51 | `GET /financial-periods` | `{ data, meta }` | `data.data` | OK — envelope |
| 52 | `GET /expenses` | `{ data, meta }` | `data.data` | OK — envelope |
| 53 | `GET /expense-categories` | array | array | OK — array |

### HR and payroll

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 54 | `GET /employees` | `{ data, meta }` | `data.data` | OK — envelope |
| 55 | `GET /departments` | `{ data, meta }` | `data.data` | OK — envelope |
| 56 | `GET /designations` | array | array | OK — array |
| 57 | `GET /tasks` | `{ data, meta }` | `data.data` | OK — envelope |
| 58 | `GET /payroll/payslips` | `{ data, meta }` | `data.data` | OK — envelope |
| 59 | `GET /payroll/salary-structure/history/:id` | array | array | OK — array |
| 60 | `GET /hr/attendance` | `{ data, meta }` | `data.data` | OK — envelope |
| 61 | `GET /hr/leave-requests` | `{ data, meta }` | `data.data` | OK — envelope |
| 62 | `GET /hr/leave-types` | array | array | OK — array |
| 63 | `GET /hr/leave-balances` | array | array | OK — array |
| 64 | `GET /hr/leave-calendar` | array | array | OK — array |
| 65 | `GET /hr/shifts` | array | array | OK — array |
| 66 | `GET /hr/attendance/devices` | array | array | OK — array |
| 67 | `GET /hr/commissions/earnings` | `{ data, meta }` | `data.data` | OK — envelope |

### Marketing

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 68 | `GET /marketing/platforms` | array | array | OK — array |
| 69 | `GET /marketing/connections` | array | array | OK — array |
| 70 | `GET /marketing/campaign-aliases` | array | array | OK — array |
| 71 | `GET /marketing/payments/credit-due` | array | array | OK — array |
| 72 | `GET /marketing/campaigns` | `{ data, total, page, perPage, totalPages }` | same (`Paginated<T>`) | OK — custom |
| 73 | `GET /marketing/analysis/*` | named KPI/report objects | same | OK — custom |
| 74 | `GET /campaigns` | `{ data, meta }` | `data.data` | OK — envelope |

### Courier and courier settlement

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 75 | `GET /couriers/credentials` | array | array | OK — array |
| 76 | `GET /couriers/credential-sets` | array | array | OK — array |
| 77 | `GET /couriers/cities` | array | array | OK — array |
| 78 | `GET /couriers/customer-history` | named object | same | OK — custom |
| 79 | `GET /courier-settlement/invoices` | `{ data, meta }` | `data.data` | OK — envelope |
| 80 | `GET /courier-settlement/reconciliation` | `{ data, meta }` | `data.data` | OK — envelope |
| 81 | `GET /courier-settlement/finance-rules` | array | array | OK — array |
| 82 | `GET /courier-settlement/exceptions` | array | array | OK — array |
| 83 | `GET /courier-settlement/mappings` | `{ data, fields, total }` | `mappings.data?.data` | OK — custom |
| 84 | `GET /courier-settlement/activity` | array | array | OK — array |
| 85 | `GET /courier-settlement/adjustments` | array | array | OK — array |

### System, security, shipping settings

| # | Endpoint | Backend body | Admin consumer | Verdict |
| --- | --- | --- | --- | --- |
| 86 | `GET /admin/security/dashboard/summary` | named object | same | OK — custom |
| 87 | `GET /admin/backup` | `BackupListResponse` object | same | OK — custom |
| 88 | `GET /business-analytics/*` | `{ data, … }` report objects | same | OK — custom |
| 89 | `GET /access-presets` | `{ data, meta }` | `data.data` | OK — envelope |
| 90 | `GET /shipping/options` | array | array | OK — array |
| 91 | `GET /shipping/zones` | array | array (after fix) | **FIXED — admin** |
| 92 | `GET /order-statuses` | array | array | OK — array |
| 93 | `GET /auth-settings` | array | array | OK — array |
| 94 | `GET /gateways/admin` | array | array | OK — array |

## Mismatches fixed

### 1. `GET /accounts` — backend now returns `{ data, meta }` (FIXED — backend)

**Symptom:** the chart-of-accounts parent picker and the account selects in journal entries / reports were permanently empty. All of those consumers read `response.data.data`; the controller returned the service's bare array.

**Fix:** `apps/backend/src/accounts/accounts.controller.ts` slices the service array and returns the same envelope as `GET /accounting/entries` / `GET /financial-periods`:

```json
{ "data": [...], "meta": { "total": 25, "page": 1, "perPage": 10, "totalPages": 3 } }
```

Pagination is validated (`page`/`perPage` must be positive integers → `400`). The service keeps returning a plain array for its internal callers.

**Consumers updated in the same commit**

- `apps/admin/src/features/accounting/chart-of-accounts.tsx` — already `flatAccounts?.data`.
- `apps/admin/src/features/accounting/journal-entries.tsx` — already `Array.isArray(x?.data) ? x.data : []`.
- `apps/admin/src/features/accounting/reports.tsx` — already `Array.isArray(x?.data) ? x.data : []`.
- `apps/admin/src/features/expenses/index.tsx` — now requests `perPage: 200` and reads `accounts?.data` (`allAccounts` was dead code but is now correct).
- `apps/admin/src/features/marketing/api.ts` — unused `accounts.list` helper retyped to the envelope.

**Contract tests:** `apps/backend/src/accounts/__tests__/accounts.controller.spec.ts` — envelope shape, page/perPage/type passthrough, last partial page, `400` on invalid pagination.

### 2. `GET /reviews` — admin consumer now reads the envelope (FIXED — admin)

**Symptom:** the reviews moderation screen was always empty. The backend already returned `{ data, meta }`; the admin typed the body as `ReviewItem[]` and `Array.isArray(reviews)` was false.

**Fix:** `apps/admin/src/features/reviews/index.tsx` types the response as the envelope, requests `perPage: 100` (the screen has no pager, so the backend default of 10 would hide older reviews), and renders `reviews?.data ?? []`.

**Contract tests:** `apps/backend/src/reviews/__tests__/reviews.controller.spec.ts` — pins the envelope, page/perPage parsing, status/productId passthrough, and default `undefined` pagination.

### 3. `GET /dispatch/metrics` — admin now consumes the object (FIXED — admin)

**Symptom:** the dispatch metrics cards never rendered. Backend returns one object:

```json
{ "total": 7, "byCourier": [{ "courier": "pathao", "count": 4 }], "byStatus": [{ "status": "PENDING", "count": 5 }] }
```

Admin typed it as `Array<{ courier; status; _count }>` and called `data.reduce`, which threw.

**Fix:** `apps/admin/src/features/dispatch/api.ts` — `DispatchMetricsResponse` is the object; `getMetrics()` returns it. `apps/admin/src/features/dispatch/dispatch-metrics.tsx` reads `data.total`, `data.byCourier`, `data.byStatus`.

**Contract tests:** `apps/backend/src/dispatch/__tests__/dispatch.controller.spec.ts` — metrics object shape + the `{ data, total, facets }` list shape next to it.

### 4. `/shipping-zones` → `/shipping/zones` (FIXED — admin)

**Symptom:** the admin order form called a route that does not exist, so zone-based delivery charges were ignored and the suggestion fell back to the flat default.

**Fix:** `apps/admin/src/features/orders/create.tsx` calls `GET /shipping/zones` (the real `ShippingController` route, returning the zone-group array consumed by `resolveCityCharge`).

### 5. C4 — backfill dry-run truthfulness (FIXED — backend)

**Symptom:** `POST /accounting/payments/backfill-journals { dryRun: true }` labelled every scanned row `skipped / dry_run`, including rows the real run would skip for COD or post successfully. The report could not answer “what will actually happen?”.

**Fix:** `apps/backend/src/accounting/payment-journal.service.ts`

- `PaymentJournalStatus` gains `would_post`.
- `tryPostOrderPayment`, `tryPostPayrollPayment`, `tryPostSupplierPayment` accept `{ dryRun?: boolean }`.
- Dry-run runs the **identical guard chain** in the same order — not found, already journaled (`adopted`), not recorded, COD guard, unmapped account, accounting disabled, zero amount — then returns `{ status: 'would_post', journalEntryId: null, reason: 'dry_run' }` **without** taking the row lock, writing an entry, or calling `resolveLegs` (which lazily creates system accounts).
- `backfillRecordedPayments` passes `{ dryRun }` to every poster instead of synthesising a skip; the result gains a truthful `wouldPost` counter next to `posted`/`adopted`/`skipped`/`failed`.
- Candidate scan scope is unchanged (`journalEntryId: null`, `voidedAt: null`, mapped account, positive receipts) — “already journaled” and “unmapped” remain out of scope by design, not silently mislabelled.

**Tests:** `apps/backend/src/accounting/__tests__/payment-journal.spec.ts` — dry-run parity (3 `would_post` + 1 COD skip, zero writes, zero lazily-created accounts), accounting-disabled reports the real gate (COD still reports COD), already-journaled reports `adopted`, and `dryRun.wouldPost === realRun.posted`.

## Deliberately NOT fixed

| Surface | Why not |
| --- | --- |
| `GET /categories` | **Type-only drift.** Backend returns a bare array and every runtime consumer already tolerates it (`Array.isArray` guards / `.map`), except `combo-form.tsx` which requires a bare array. Wrapping it in `{ data, meta }` would force 6+ consumer edits and break the combo form for no runtime gain. Documented, not changed. |
| `marketingApi.audit` | Flat `{ data, total, page, perPage, totalPages }` pagination. The helper is unused and the shape is intentional (custom pagination). Documented, not changed. |
| Backfill scan-scope exclusions | Unmapped payments and already-journaled rows are not candidates by design. The report is now truthful about every row it *does* scan; widening the scan would change the operation's contract and is out of scope. |

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Targeted backend suites | `cd apps/backend && npx jest src/accounting/__tests__/payment-journal.spec.ts src/accounts/__tests__/accounts.controller.spec.ts src/reviews/__tests__/reviews.controller.spec.ts src/dispatch/__tests__/dispatch.controller.spec.ts --runInBand` | **39/39 passed, 4 suites** |
| Full backend suite | `cd apps/backend && npx jest --runInBand` | **5311 passed, 2 skipped (5313), 369 suites** |
| Backend build | `cd apps/backend && npx nest build` | **exit 0** |
| Admin typecheck | `cd apps/admin && npx tsc --noEmit -p tsconfig.app.json` | **exit 0** |
| Admin suite | `cd apps/admin && npx vitest run --browser.headless` | **1379/1379 passed, 154 files** |

## Owner decisions / follow-ups

- **Envelope convention:** paginated admin lists use `{ data, meta }`; bare arrays remain valid for full-set lists that the UI consumes wholesale; named object shapes are valid when they are intentional and typed (dispatch facets, marketing flat pagination, KPI reports).
- **No service contract changes:** every fix sits at the controller boundary or in the consumer. Internal service return types are untouched.
- **`/categories`:** if the team later wants one envelope everywhere, migrate it with the combo form and all consumers in one change; until then the type annotation in admin should be corrected to `Category[]` (follow-up, not part of this sweep).
- **C4 API consumers:** any external caller of the backfill endpoint should read `wouldPost` for dry-run planning; `skipped` now contains only genuine skips.
- **Blocked items:** none.
