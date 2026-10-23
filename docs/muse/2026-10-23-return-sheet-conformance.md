# Return / Exchange Conformance Audit — 2026-10-23

**Authority:** Google Sheet — “EcoMate — Courier Status Mapping (Latest Docs)”, TSV export:
`03-Rules.tsv` (Rules 2, 15, 16, 19, 20, 25, 26, 27) + `08-Return_Creation.tsv` (rows 1–29),
`01-Mapping.tsv`, `02-Our_Statuses.tsv`।
**Worktree:** `a-return-conformance` · **Branch:** `burndown/a-return-conformance`
**Scope:** ছয়টি conformance point — (a) partial auto-create নিষেধ, (b) FULL return একটাই + idempotency,
(c) courier “received” → Return stage `delivered`, (d) dispatch/order cap `RETURN_PENDING`,
(e) exchange displayId `Ex-XXXX`, (f) FULL exchange-এ একটাই linked Return।

## সারসংক্ষেপ (Verdict Table)

| # | Point | Verdict | মূল পরিবর্তন |
|---|-------|---------|--------------|
| (a) | PARTIAL return কখনো auto-create নয় | **সংশোধিত — PASS** | Steadfast reconcile ও Pathao partial signal আর `PARTIAL` Return বানায় না; HOLD + staff alert |
| (b) | FULL return — যেকোনো courier, একটাই Return, idempotent, conditional cancel সহ | **সংশোধিত — PASS** | `upsertCourierReturn` link-first + per-order advisory lock + `createIfMissing`; webhook + manual sync দুই path-এ একই signal |
| (c) | Courier “received” → Return stage `delivered`, কখনো `received` নয়; stock শুধু staff confirm-এ | **সংশোধিত — PASS** | নতুন `ReturnStatus.DELIVERED` (DDL-only migration); `recordCourierParcelBack`; reconcile আর restock করে না |
| (d) | Courier event-এ dispatch/order সর্বোচ্চ `RETURN_PENDING`, কখনো `RETURNED` নয় | **সংশোধিত — PASS** | Pathao/Carrybee `returned-to-merchant`, Steadfast `returned`/`cancelled_return_received`, keyword `/returned/` — সব `RETURN_PENDING` |
| (e) | Exchange displayId `Ex-XXXX`, `ORD-` নয় | **সংশোধিত — PASS** | prefix `EX-` → `Ex-`; scanner regex `(ORD\|RTN\|EX)` |
| (f) | FULL exchange-এ creation-এর সময়েই একটাই linked Return | **ইতিমধ্যে সঠিক — PASS** | `ExchangeService.createFromOrder` একই transaction-এ একটাই `Return(EXCHANGE)` বানায়; regression test আগে থেকেই ছিল |

**কোনো point বাকি নেই।** Owner-decision `[?]` আইটেমগুলো ইচ্ছাকৃতভাবে implement করা হয়নি (নিচে তালিকা)।

---

## (a) PARTIAL return কখনো auto-create হয় না

**Sheet:** Rule 27(b) — partial returns কখনো auto-create নয়, কারণ courier API কোন item/quantity ফেরত
এসেছে তা বলে না; HOLD + staff alert, staff নিজে actual items দিয়ে Return বানাবে। Return Creation
rows 18–27 একই কথা বলে।

**আগের অবস্থা (gap):**
- `reconcileSteadfastReturn` `partial_delivered_return_*` label-এ একটি `PARTIAL` Return auto-create করত।
- Pathao `order.return-id-created` + `return_type: partial-delivery`-ও `PARTIAL` Return বানাত।

**এখন:**
- `apps/backend/src/courier-manager/courier-status-mapper.ts:411` — `RETURN_SIGNAL_PARTIAL` সেট;
  `:438` — partial signal-এ `createIfMissing: false`, `_received` হলে stage `DELIVERED`।
- `apps/backend/src/returns/returns.service.ts:909` — `createIfMissing = type !== 'PARTIAL' && input.createIfMissing !== false`।
  `:938` — active Return না থাকলে create নয়, শুধু warn (HOLD + staff alert) এবং `null` রিটার্ন।
- `apps/backend/src/courier-manager/courier-webhook.service.ts:783` — signal link না হলে loud
  “HOLD + staff alert (sheet Rule 27b)” log; `:913` — reconcile-এ `returnStatus = 'HELD'`, stock untouched।
- `:319` — Steadfast webhook return-label skip (return শুধু reconcile endpoint দিয়ে আসে)।

**Tests:** `returns/__tests__/return-sheet-conformance.spec.ts:31` (চারটি partial label + stage),
`:221` (Pathao partial-delivery), `:233` (active Return নেই → কোনো stage write নেই, শুধু warn);
`returns.service.spec.ts:485` (PARTIAL → `null`, `create` call হয়নি)।

## (b) FULL return — একটাই Return, যেকোনো courier, idempotent

**Sheet:** Rule 27(a) — যেকোনো courier event যেটি dispatch `RETURN_PENDING`-এ map করে, প্রথম event-এ
একটাই Return create/link করবে; পরের events শুধু link করবে; courier return ID পেলে store করবে;
conditional-cancel returns (Rule 16) সহ; প্রথম event-ই back-with-merchant হলে সরাসরি stage `delivered`।
Rule 19 — সব return (staff/courier/exchange/partial/full) একটাই unified Return record।

**আগের অবস্থা (gap):** lookup courier/return-id-কেন্দ্রিক ছিল — ভিন্ন courier বা ID-বিহীন পরের event
নতুন Return বানাতে পারত; conditional-cancel return wired ছিল না।

**এখন:**
- `apps/backend/src/returns/returns.service.ts:902` — `upsertCourierReturn`; `:914` — ORDER-ভিত্তিক
  link-first lookup (`status != CLOSED`, newest first), source/courier নির্বিশেষে; `:923`/`:928` —
  `courierReturnId` ও `courier` set-once; `:950` — কিছু না থাকলে তবেই create (`source: COURIER`,
  empty items, `status: REQUESTED`)।
- `:978` — `lockOrderReturnSignal` → `pg_advisory_xact_lock(hashtext(orderId))`; lock-এর ভিতরে
  আবার lookup — webhook + manual sync race-এও একটাই row।
- `apps/backend/src/courier-manager/courier-webhook.service.ts:757` — `recordCourierReturnSignal`
  (সব courier + sync path-এর একক entry); `:726` — `linkCourierReturn` best-effort।
- Wiring: Pathao `:1423`, RedX `:1599`, Carrybee `:1783`, Steadfast reconcile `:901`,
  Steadfast conditional cancel `:386`।
- `apps/backend/src/dispatch/dispatch.service.ts:1194` — `recordSyncReturnSignal`; দুই sync branch-এ
  call (`:1040`, `:1123`), conditional cancel resolve সহ।
- Guard interaction: staff path আগের মতোই `assertReturnEligible` ব্যবহার করে; courier path ইচ্ছাকৃতভাবে
  order-status gate ছাড়া (external fact; `COURIER_GUARD_SKIP_REASON`) — sheet Rule 27(a) অনুযায়ী
  Return Pending-এ থাকা order-এও courier signal record হয়। Link-first হওয়ায় ONE-active-Return
  invariant ভাঙে না।

**Tests:** `return-sheet-conformance.spec.ts:55` (সব courier label → FULL + `createIfMissing: true`),
`:80` (back-with-merchant → stage `DELIVERED`), `:206`/`:246`/`:259` (Pathao/Carrybee/RedX wiring),
`:286`/`:309` (conditional cancel picked-up vs never-picked-up), `:268` (Pathao back-with-merchant)।
`returns.service.spec.ts:438` — দুটি ধারাবাহিক signal → মাত্র **একটি** create, দ্বিতীয়টি link
(`courierReturnId` clobber হয় না)। `dispatch.service.spec.ts` sync-path expectations updated।

## (c) Courier “received” → Return stage `delivered` (কখনো `received` নয়)

**Sheet:** Rule 2 + Rule 25 + Return Creation rows 5/9/16 — courier-এর back-with-merchant signal
Return-এর stage `delivered` করে; `received` মানে **staff-confirmed** physical receipt; stock reconcile
শুধু তখনই। `receivedAt`/`receivedById` courier signal-এ কখনো set হয় না।

**আগের অবস্থা (gap):** `ReturnStatus`-এ `DELIVERED` ছিল না; reconcile courier “received”-এ
`RECEIVED` set করে stock restore করত।

**এখন:**
- `apps/backend/prisma/schema.prisma:1540` — `enum ReturnStatus`-এ `DELIVERED` (comment সহ)।
- `apps/backend/prisma/migrations/20261023100000_return_status_delivered/migration.sql` — শুধু
  `ALTER TYPE ... ADD VALUE 'DELIVERED'` (guarded `duplicate_object`); **DDL-only**, কোনো DML নেই
  (55P04 এড়াতে)।
- `apps/backend/src/returns/returns.service.ts:841` — `recordCourierParcelBack`: `REQUESTED`/`IN_TRANSIT`
  → `DELIVERED`; `RECEIVED`/`RESTOCKED`/`CLOSED` কখনো regress নয়; raw `courierStatus` রেকর্ড হয়;
  stock/actor স্পর্শ করে না।
- `apps/backend/src/courier-manager/courier-webhook.service.ts:901` — reconcile শুধু stage signal পাঠায়;
  `:934` — `returnStatus = 'DELIVERED'`, `stockReconciled = false`; `:940` — staff receive বাধ্যতামূলক log।
- `apps/backend/src/returns/returns.service.ts:578` — `markReceived` (staff) → `restockReturn` →
  `RECEIVED`/`RESTOCKED`; এখানেই একমাত্র stock movement ও receiver stamp।
- `apps/backend/src/common/finance/return-impact.ts:18` — `RECEIVED_RETURN_STATUSES = RECEIVED,
  RESTOCKED, CLOSED`; `DELIVERED` সঠিকভাবে বাদ (finance/reporting DELIVERED-কে received ধরে না)।

**Tests:** `return-sheet-conformance.spec.ts:319` (cancelled_return_received → dispatch `RETURN_PENDING`,
Return `DELIVERED`, `restockReturn`/`restoreForOrder` call হয়নি); `returns/__tests__/received-by.spec.ts:120`
(parcel-back → `DELIVERED`, কোনো actor নেই), `:135` (staff-received row regress হয় না)।

## (d) Courier event-এ dispatch/order সর্বোচ্চ `RETURN_PENDING`

**Sheet:** Rule 2 / 25 / 26 — courier signal কখনো dispatch/order `RETURNED` করে না; `RETURNED` শুধু
staff Return receive করলে; order `Returned`-ও manual (Rule 26)।

**আগের অবস্থা (gap):** Pathao/Carrybee `order.returned-to-merchant`, Steadfast tracking `returned` ও
`cancelled_return_received`, এবং keyword `/returned/` — এগুলো `RETURNED`-এ map করত।

**এখন:**
- `apps/backend/src/courier-manager/courier-status-mapper.ts:53` (Steadfast `returned`),
  `:79` (`cancelled_return_received`), `:121` (Pathao `order.returned-to-merchant`),
  `:216` (Carrybee `order.returned-to-merchant`), `:250` (keyword fallback `/return/i`) — সব
  `RETURN_PENDING`; `:184` RedX `returned` → `RETURN_PENDING`।
- Webhook dispatch maps (Pathao/Carrybee/RedX/Steadfast) একই nilai ধরে; sync path-ও
  `dispatch.service.ts:1202` mapper ব্যবহার করে।
- `RETURNED` একমাত্র `markReceived`-এ (`returns.service.ts:603`, staff-confirmed FULL)।
  Order-এ `Return Pending`-এর বেশি advance হয় না (`DISPATCH_TO_ORDER_STATUS` মানচিত্র)।

**Tests:** `return-sheet-conformance.spec.ts:110` — তালিকাভুক্ত সব return label-এ
`mapCourierStatusToDispatchStatus(...) !== 'RETURNED'`; `:268` ও `:319` webhook-level dispatch
`RETURN_PENDING` pin করে। `dispatch.service.spec.ts`-এ sync-path expectations `RETURN_PENDING`-এ update।

## (e) Exchange displayId `Ex-XXXX`

**Sheet:** Rule 19 / Rule 20 — exchange order-এর displayId `Ex-XXXX`, sequential, unique; `ORD-XXXX`
নয়। (Sheet-এর Bengali সারাংশে একটি জায়গায় `ORD-XXXX` লেখা আছে — নিচে owner note দেখুন।)

**আগের অবস্থা (gap):** generator `EX-` prefix দিত; scanner `ORDER_NUMBER` regex-এ `EX` ছিল না,
তাই `Ex-…` scan resolve করত না।

**এখন:**
- `apps/backend/src/exchange/exchange.service.ts:855` — `deriveExchangeDisplayId` → `Ex-${YYMMDD}`;
  comment-এ Rule 20 উদ্ধৃত।
- `apps/backend/src/scanner/scanner-resolver.ts:16` — `ORDER_NUMBER = /^(ORD|RTN|EX)-\d{6}-\d{4}$/`;
  lookup `mode: 'insensitive'`, তাই `Ex-…` ও `EX-…` দুটোই resolve হয়।
- `apps/admin` exchange list/detail existing displayId সরাসরি দেখায় (কোনো client-side prefix logic নেই)।

**Tests:** `scanner/scanner.service.spec.ts:149` (`ex-261023-0001` → `Ex-261023-0001`, kind `EXCHANGE`),
`:162` (QR URL path segment); `exchange/__tests__/exchange.service.spec.ts:342` — `/^Ex-\d{6}-\d{4}$/`।

## (f) FULL exchange — creation-এ একটাই linked Return

**Sheet:** Rule 20 — FULL exchange: এক নতুন `EXCHANGE` order + এক `Return` (type `EXCHANGE`, items =
original order-এর সব item), একই সময়ে; Return-টাই return record, আলাদা return Order নয়।

**অডিট ফল:** কোড আগে থেকেই সঠিক — কোনো পরিবর্তন প্রয়োজন হয়নি (শুধু comment/doc স্পষ্ট করা হয়েছে)।
`apps/backend/src/exchange/exchange.service.ts:283` `createFromOrder`; `:448` displayId; `:629` —
একই `$transaction`-এর ভিতরে `Return` create (`type: 'EXCHANGE'`, `source: 'EXCHANGE'`,
`exchangeOrderId: created.id`)। দ্বিতীয়বার create করার কোনো path নেই; `:165` existing EXCHANGE
Return lookup idempotency guard হিসেবে কাজ করে।

**Tests:** `exchange/__tests__/exchange-f8-flow.spec.ts:225` — FULL-এ **এক** exchange order +
**এক** `Return(EXCHANGE)`; `:282` — PARTIAL-ও একই transaction-এ এক Return। (আগে থেকেই pin করা ছিল।)

---

## Tests যোগ/আপডেট

**নতুন spec:** `apps/backend/src/returns/__tests__/return-sheet-conformance.spec.ts` — **14 tests**
(mapper-level (a)(b)(d) + webhook wiring: Pathao/Carrybee/RedX/Steadfast, partial hold,
conditional cancel দুই দিক, back-with-merchant `DELIVERED`, `return_request` link-only)।

**যোগ হয়েছে:**
- `apps/backend/src/returns/returns.service.spec.ts` — “two courier signals … exactly ONE Return” (create → link, set-once ID)।
- `apps/backend/src/scanner/scanner.service.spec.ts` — `Ex-XXXX` scan + exchange QR URL (২টি)।

**আপডেট হয়েছে (নতুন আচরণ pin করতে):** `courier-status-mapper.spec.ts`,
`courier-webhook-task5.spec.ts`, `courier-webhook-task6.spec.ts`,
`courier-webhook-partial-restore.spec.ts` (partial policy rewrite), `courier-return-task6.spec.ts`,
`courier-taskA-batch.spec.ts`, `returns.service.spec.ts`, `return-eligibility.spec.ts`,
`received-by.spec.ts`, `exchange.service.spec.ts`, `dispatch.service.spec.ts`।

## Regression (exact commands)

```
cd apps/backend && npx jest --runInBand
  → Test Suites: 369 passed, 1 skipped (370 total)
  → Tests: 5320 passed, 2 skipped (5322 total)

cd apps/backend && npx nest build
  → exit 0

cd apps/backend && npx prisma validate
  → schema valid
cd apps/backend && npx prisma migrate deploy
  → 20261023100000_return_status_delivered applied (178 migrations)

cd apps/admin && npx tsc -b            → exit 0
cd apps/admin && npx vitest run        → 1379 passed (154 files)

cd apps/storefront && npm test         → 466 passed (61 files)
```

## Owner decisions — `[?]` (implement করা হয়নি, শুধু রিপোর্ট)

1. **Pathao `order.returned`** — sheet বলে `[?] if after partial-delivery, may be partial in reality`;
   বর্তমানে FULL ধরা হয় (sheet-এর “Return created = FULL” অনুযায়ী)।
2. **Pathao / Carrybee `order.paid-return`** — `[?] assumed FULL - confirm`; বর্তমানে FULL।
3. **RedX back-with-merchant** — sheet-এ এমন event নেই (`[?] never reaches RETURNED?`); তাই RedX
   signal থেকে Return কখনো `DELIVERED` হয় না — staff receive-ই একমাত্র পথ।
4. **Steadfast `return_request` / `return_list_accepted`** — `[?] create FULL if no linked return exists?`;
   বর্তমানে **LINK-only** (`createIfMissing: false`)।
5. **Sheet Bengali সারাংশ** — exchange displayId-এর জন্য `ORD-XXXX` লিখেছে, যা Rules 19–20-এর
   `Ex-XXXX`-এর সাথে সাংঘর্ষিক; authoritative Rules 19–20 implement করা হয়েছে। Sheet-এ inconsistency
   flag করা হলো।

## Blocked items

কিছুই নেই। কোনো live courier API call করা হয়নি; কোনো credential reproduce করা হয়নি।

## Changed files (high level)

- Backend: `returns/returns.service.ts`, `courier-manager/courier-status-mapper.ts`,
  `courier-manager/courier-webhook.service.ts`, `dispatch/dispatch.service.ts`,
  `exchange/exchange.service.ts`, `scanner/scanner-resolver.ts`, `returns/dto/return.dto.ts`,
  `prisma/schema.prisma` + নতুন migration, সংশ্লিষ্ট specs + নতুন conformance spec।
- Admin: `features/returns/index.tsx` (`DELIVERED` status filter)।
