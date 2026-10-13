# PR — Payment ledger overhaul: verification workflow, customer credit, post-dispatch COD alert

**Squash-merge message:** `feat(admin): payment ledger overhaul — verification workflow, customer credit, post-dispatch COD alert`

**Branch:** `feat/payment-ledger-and-cod-alert` → `main` (squash). Owner pushes; do NOT push from this session.

**Plan:** `docs/superpowers/plans/2026-10-13-payment-ledger-and-cod-alert.md` (untracked, stays untracked — see §7).

---

## 1. Fresh verification evidence (Task 12, run 2026-10-13 ~22:45 +0600)

| Check | Result |
|---|---|
| `npx prisma validate` (apps/backend) | valid, exit 0 |
| `npx prisma migrate status` | `Database schema is up to date!` — 155 migrations, exit 0. The hand-amended `20261013125708` file produced NO complaint (local dev DB already aligned; see §6 follow-up 5) |
| FULL `npx jest` (apps/backend) | **293 suites / 4387 tests — all pass** |
| `npx nest build` (apps/backend) | exit 0, no output |
| FULL `npx vitest run` (apps/admin) | **111 files / 1056 tests — all pass**, exit 0 |
| `npx tsc --noEmit` (apps/admin) | exit 0 |
| Storefront diff vs `origin/main` | **empty** — untouched, no test run needed |
| Scope diff vs `origin/main` | 73 files, **backend + admin only**; zero compose/env/portainer/CI/Dockerfile/storefront paths → deploy-sync gate trivially satisfied |
| Schema+migration pairing | `20261013125708` + schema edit in `cdb5a971`; `20261013204834` + schema edit in `23880f08` — both committed together |

**Gate verdict: PASS — no suite failures, nothing blocked.**

---

## 2. Per-commit list (21 commits, `origin/main..HEAD`)

Backend (oldest → newest):

1. `cdb5a971` feat(payments): ledger schema — account, actor, recordedAt, COD alert, credit ledger (+ migration `20261013125708`, append-only spec)
2. `087a7aae` feat(cod): shared COD mismatch recompute service with timeline audit
3. `69be14b6` fix(cod): timeline only on raise or amount change
4. `e9391b05` feat(cod): persist dispatch-time collectable amount (courier-manager + dispatch paths)
5. `04fc2607` feat(cod): recompute COD alerts from all collectable mutation paths
6. `d7e04605` fix(cod): bind alert resolve to order (wrong-order resolve → 404, nothing updated)
7. `ee6e7e64` feat(payments): append-only ledger, S2 edit gate, D4 server date, account validation
8. `f77db053` feat(payments): verification workflow — S1, approve permission, self-approve block
9. `6d0b0eac` fix(auth): fail-closed verifier id on order verify-payment (`user?.userId` → `user.userId`, 1 line)
10. `da6c5242` feat(settings): S1 auto-verify default ON, S2 edit default OFF (manual gateways) + seed
11. `0782d70b` fix(settings): gate `payments.*` writes to admin, manual-only toggles, S2 tests
12. `6397bc71` feat(credit): overpayment grants credit, apply-credit clamped, profile ledger
13. `02f6ecdb` fix(credit): grant overpay credit on verification (PENDING→PAID path, no double-grant)
14. `23880f08` feat(refund): cancel blocked until refund, atomic cancel-too option (+ migration `20261013204834`)

Admin UI:

15. `296dee35` feat(ui): derived payment mode + prominent Due block (D6)
16. `ba0c2b69` fix(ui): refunded/cancelled orders show Refunded + zero due
17. `91a9a743` feat(ui): COD mismatch banner + derived list badge (A)
18. `d7685c0e` feat(ui): payment ledger card + record/refund modals, S2-gated edits (B)
19. `1e79b2a1` feat(ui): order-create multi-row payments + apply-credit offer (C)
20. `cffa45b8` feat(ui): verification ledger columns, pending/verified filter, self-approve gate (D)
21. `f379ce87` feat(ui): customer credit balance card (E)

---

## 3. Acceptance checklist — automated mapping + owner manual steps

Setup for all API steps (backend on `:4000`, admin on `:5173`):

```bash
API=http://localhost:4000
TOKEN=$(curl -s $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@ecomate.com","password":"Admin@123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
H="Authorization: Bearer $TOKEN"
```

Admin UI login: `http://localhost:5173` → `admin@ecomate.com` / `Admin@123`.

### (a) Second payment INSERTs a row, first row untouched + timeline

- Auto: `apps/backend/src/payments/__tests__/ledger-behavior.spec.ts:87` (`second payment INSERTs, first row untouched (no UPDATE/DELETE)`); schema/append-only guard `apps/backend/src/payments/__tests__/ledger-append-only.spec.ts:148` (migration is append-only, zero DROP lines).
- UI: order detail → payment card lists both rows with signed amounts; no edit buttons on listed rows (`apps/admin/src/features/orders/components/payment-ledger-card.test.tsx:40`).
- API:
  ```bash
  curl -s $API/payments/<ORDER_ID> -H "$H" -H 'Content-Type: application/json' \
    -d '{"gatewayCode":"bkash","account":"bkash 017XXXXXXXX","amount":500,"transactionId":"TX-A1"}'
  curl -s $API/payments/<ORDER_ID> -H "$H" -H 'Content-Type: application/json' \
    -d '{"gatewayCode":"bkash","account":"bkash 017XXXXXXXX","amount":300,"transactionId":"TX-A2"}'
  curl -s $API/orders/<ORDER_ID> -H "$H" | python3 -c 'import sys,json;o=json.load(sys.stdin);print([(p["amount"],p["status"]) for p in o["payments"]])'
  # expect 2 rows, first still 500; order timeline contains a payment-recorded entry
  ```

### (b) S2 OFF: edit hidden in UI + backend 403

- Auto: `apps/backend/src/orders/orders.service.spec.ts:3911` (`S2 OFF (default): amount/account change on existing row → 403, no UPDATE`); S2-ON audit variant `:3932`.
- UI: S2 OFF → payment card shows no edit affordances (`payment-ledger-card.test.tsx:40`); S2 toggle lives only in manual-gateway cards (`apps/admin/src/features/gateways/__tests__/manual-payment-settings.test.tsx:107,114,153`).
- API: with S2 OFF (default), attempt a payment-field change via order update:
  ```bash
  curl -s -X PUT $API/orders/<ORDER_ID> -H "$H" -H 'Content-Type: application/json' \
    -d '{"paymentOptionType":"CASH_ON_DELIVERY","gatewayCode":"cash"}'
  # → 403 matching /edit.*disabled.*correction/; record a correction entry instead
  ```

### (c) Manual entry without account → 400 (never silent manual)

- Auto: `apps/backend/src/payments/__tests__/ledger-behavior.spec.ts:122` (+ unknown-code-as-manual `:135`, negative-needs-reason `:147`, zero rejected `:184`); create-form rule `apps/admin/src/features/orders/components/create-payments-section.test.ts:45`.
- UI: record-payment modal blocks submit without gateway/account; txn required exactly when S1 OFF (`apps/admin/src/features/orders/components/record-payment-modal.test.tsx:29,58`).
- API:
  ```bash
  curl -s $API/payments/<ORDER_ID> -H "$H" -H 'Content-Type: application/json' \
    -d '{"gatewayCode":"bkash","amount":500,"transactionId":"TX-NOACC"}'
  # → 400 matching /account/i (no row written)
  ```

### (d) Customer manual → PENDING → staff approve; self-approve → 403

- Auto: customer-always-PENDING `ledger-behavior.spec.ts:258`; self-approve 403 `apps/backend/src/payments/__tests__/verification-workflow.spec.ts:190` (payments path) + `:317` (order verify path); approve-by-other sets verified/By/At `:206`; catalogue key `:54`; decorator `:140`.
- UI: verification list shows account + txn columns, pending/verified filter, self-recorded rows disabled with hint (`apps/admin/src/features/payments/__tests__/payment-verification-ledger.test.tsx:73,82,90,98`).
- API:
  ```bash
  # customer/guest submission (no token) → PENDING
  curl -s $API/payments/<ORDER_ID> -H 'Content-Type: application/json' \
    -d '{"gatewayCode":"bkash","account":"bkash 017XXXXXXXX","amount":500,"transactionId":"TX-C1"}'
  # approve as a DIFFERENT staffer (admin seed) → PAID + verifiedBy/At
  curl -s -X PUT $API/payments/<PAYMENT_ID>/verify -H "$H" -H 'Content-Type: application/json' \
    -d '{"status":"PAID"}'
  # self-approve: staff records an entry, then verifies it with the SAME user → 403
  ```

### (e) S1 OFF: staff manual → PENDING + txn required

- Auto: `ledger-behavior.spec.ts:231` (staff + S1 OFF → PENDING, txn required); S1-ON default PAID `:215`; settings defaults `:302`; stored-values honored `:311`.
- UI: Gateways → manual card → toggle S1 OFF; record modal then requires txn (`record-payment-modal.test.tsx:29`); create-form row rule (`create-payments-section.test.ts:53`).
- API:
  ```bash
  # S1 OFF first (admin-only since 0782d70b):
  curl -s -X POST $API/system-settings -H "$H" -H 'Content-Type: application/json' \
    -d '{"key":"payments.staffAutoVerified","value":"false"}'
  curl -s $API/payments/<ORDER_ID> -H "$H" -H 'Content-Type: application/json' \
    -d '{"gatewayCode":"bkash","account":"bkash 017XXXXXXXX","amount":500}'
  # → 400 'Transaction ID is required for payments awaiting verification'
  # retry with "transactionId":"TX-S1" → 201 with status PENDING. Restore S1 afterwards.
  ```

### (f) Overpay → credit granted → visible → applied (clamped)

- Auto: marginal-excess grant `apps/backend/src/customer-credit/__tests__/customer-credit.service.spec.ts:55,81`; no-grant exact/under `:95`, PENDING `:115`; clamp `:181`; zero-balance/guest guards `:212,229`; double-apply safety `:247`; profile balance+ledger `:263`; verify-path grant `:481`; no double-grant `:512`; controller RBAC `:552,564`; no double recompute `:394`.
- UI: customer profile shows prominent balance + mini-ledger (`apps/admin/src/features/customers/components/credit-balance-card.test.tsx:29,47`); order-create offers apply-credit (`create.tsx` via `1e79b2a1`).
- API:
  ```bash
  # overpay a 1000-total order by 500 (S1 ON → PAID directly)
  curl -s $API/payments/<ORDER_ID> -H "$H" -H 'Content-Type: application/json' \
    -d '{"gatewayCode":"bkash","account":"bkash 017XXXXXXXX","amount":1500,"transactionId":"TX-OVER"}'
  curl -s $API/customers/<CUSTOMER_ID>/credit -H "$H"   # balance 500 + entry reason overpayment:<ORDER_ID>
  curl -s -X POST $API/orders/<OTHER_ORDER_ID>/apply-credit -H "$H" -H 'Content-Type: application/json' \
    -d '{"amount":9999}'   # clamps to 500; writes customer_credit PAID row + negative credit entry
  ```

### (g) Paid cancel blocked (Bengali) → refund with cancel-too atomic

- Auto: updateStatus-blocked `apps/backend/src/orders/orders.service.spec.ts:5065`; cancelByCustomer-blocked `:5086`; legacy-refund unblocks `:5103`; bulk-cancel per-order `:5132`; refund create + negative row `:107`–`:172` in `apps/backend/src/refunds/__tests__/cancel-refund-gate.spec.ts` (method `:87`, reason `:96`, atomic `:140`, refund-only `:172`, partial-cancelToo rejected `:195`); refund caps/validation in `refunds.service.spec.ts:231,255,274`.
- UI: refund modal asks `এই অর্ডারটি কি ক্যান্সেলও হয়ে যাবে?` with `হ্যাঁ, এখনই ক্যান্সেল করো` / `পরে করব` (`apps/admin/src/features/orders/components/record-refund-modal.test.tsx:29,43,59`).
- API:
  ```bash
  curl -s -X PUT $API/orders/<PAID_ORDER_ID>/status -H "$H" -H 'Content-Type: application/json' \
    -d '{"statusId":"<CANCELLED_STATUS_ID>"}'
  # → 400 'আগে রিফান্ড করুন — this order still has an outstanding paid balance of …'
  curl -s -X POST $API/refunds -H "$H" -H 'Content-Type: application/json' \
    -d '{"orderId":"<PAID_ORDER_ID>","amount":<FULL_OUTSTANDING>,"method":"bkash","reason":"customer cancelled","cancelToo":true}'
  # → Refund row + negative PAID ledger row + order Cancelled + both timeline entries, one $transaction
  ```

### (h) Post-dispatch payment → banner exact amounts + persist + resolve audit + list badge

- Auto: raise/refresh/clear `apps/backend/src/cod-mismatch/__tests__/cod-mismatch.service.spec.ts:50,110,141,173,205,239,260`; NULL-amount skip `:125`; resolve audit `:293`; order binding `:317,344`; controller `:13,20` in `cod-mismatch.controller.spec.ts`; recompute wiring from payments `:168,178` in `payments.service.spec.ts`; dispatch-time persistence in `courier-manager.service.spec.ts:111`.
- UI: banner shows courier + consignment link + courier ৳X vs due ৳Y + diff + Bengali instruction `ডিসপ্যাচের পর COD বদলেছে। …` (`apps/admin/src/features/orders/components/cod-mismatch-banner.test.tsx:46,59,70,76`); orders list shows `COD mismatch` badge (`index.tsx:1130`, `hasOpenCodAlert` in `order-display.ts:278`).
- API:
  ```bash
  # dispatch the order first (existing dispatch flow), then record a payment so due != courier amount
  curl -s $API/orders/<ORDER_ID>/cod-alerts -H "$H"
  # → [{ courier, consignmentId, courierAmount:"<X>", systemDue:"<Y>", status:"open" }]
  curl -s -X POST $API/orders/<ORDER_ID>/cod-alerts/<ALERT_ID>/resolve -H "$H"
  # → status resolved + resolvedBy/At; order timeline has raise + resolve entries; list badge clears
  ```

### (i) Card Total / Received / Due blocks (D6)

- Auto: mode Unpaid/Partial/Paid/Credit `apps/admin/src/lib/order-display.test.ts:132,136,140,144`; ledger-derived mode `:159,163,169,175`; pending ignored `:181`; full-refund → Unpaid `:193`; cancelled+refunded → Refunded + due 0 `:207`; paid+due==total `:115,125`; list badge `:162` in `orders-page.test.tsx`.
- UI: open any order (`/admin/op/orders/$id`) — payment card shows Total / Received / Due blocks; Due prominent; overpayment renders Credit mode; refunded/cancelled renders Refunded with zero due. Order-create shows multi-row payments + txn-required-when-S1-OFF + overpayment warning + apply-credit offer (`create-payments-section.test.ts:10,45,53`; browser variant alongside).

---

## 4. Change-completeness gate (per AGENTS.md)

Spot-checked `git show --name-only` for all 21 commits: **clean, no violations.**

- Schema commits (`cdb5a971`, `23880f08`) carry migration + schema + tests in the SAME commit.
- Every backend commit carries its spec updates; every UI commit carries its vitest file.
- `6d0b0eac` is a 1-line fail-closed auth fix with no companion surface (no schema/API-shape change); its path is covered by `verification-workflow.spec.ts:317` in the adjacent commit — noted, not a violation.
- Cross-layer commits (`da6c5242` backend seed+service / admin gateway UI; `0782d70b` backend settings guard + admin toggle + both tests) kept companions together.
- No env vars, ports, volumes, topology, or CI image changes → nothing to sync across compose/`.env.example`/portainer-stack; no redeploy-affecting infra change. Full `nest build` + admin `tsc` + both suites green at HEAD serve as the build companions.

---

## 5. Squash-merge notes for owner

- Suggested title/body: the squash message above; body can link this file.
- No migration repair needed on prod/owner: both migrations apply cleanly from files (local `migrate status` = up to date, 155 migrations).
- After squash, branch `feat/payment-ledger-and-cod-alert` can be deleted locally (owner action; this session must not touch remote branches).

---

## 6. Known follow-ups (deferred, spec-sanctioned or tracked)

1. **Verify-path credit grant — DONE (not deferred).** `02f6ecdb`: PENDING→PAID verification grants the marginal excess (`customer-credit.service.spec.ts:481`), re-verify grants nothing (`:512`), non-PAID transitions grant nothing (`:531`).
2. **Task-9 outstanding-balance helper duplication — MEDIUM, deferred.** The outstanding computation exists in two places: `orders.service.ts:3500` (`outstandingRefundableBalance`, incl. the Bengali `cancelBlockedMessage` at `:3524`) and `refunds.service.ts:145`–`:172` (refund cap + cancelToo-full check). Both are covered by tests (`orders.service.spec.ts:5055`–`:5132`, `cancel-refund-gate.spec.ts:107`–`:218`); extracting a shared helper now risks the cancel-gate semantics late in the branch. Extract on next touch.
3. **List badge multi-dispatch blind spot.** The orders-list badge is boolean (`hasOpenCodAlert`, `order-display.ts:278` — any live dispatch mismatching due). With multiple live dispatches it does not say WHICH consignment mismatches; the detail banner does (per-alert rows). Acceptable: list is a signal, detail is the diagnosis.
4. **Fail-open txnId on missing settings.** `parsePaymentSettings` (`payment-settings.ts:29`) defaults absent keys to S1 ON → staff manual entries go PAID with no txnId demanded. Correct once Task 7 seeds exist, but on a settings-less DB the txn safeguard is silently off. Consider seeding in migration (not just app seed) or failing closed on absent keys.
5. **Local-only migrate-dev note.** Migration `20261013125708` was hand-amended post-apply on the LOCAL dev DB only. `migrate status` here reports up to date (no edited-migration complaint). Prod/owner deploy fresh from files, so the file is truth — no action; do not `migrate dev` repair or reset the local DB over this.
6. **NULL-courierAmount rows never alert — spec-sanctioned.** Recompute skips dispatches with NULL `courierAmount` (`cod-mismatch.service.spec.ts:125`) rather than fabricating 0. Paths that cannot resolve an amount (e.g. bulk-Steadfast unmatched invoices, `courier-manager.service.ts:991`, and any carrybee/webhook-created dispatch rows without an amount) therefore have no COD coverage for that consignment. The refresh path is also fail-open by design (`payments.service.ts:38` — alert failure never breaks the payment mutation), same as analytics invalidation.

---

## 7. Doc-file decision (Task 12 instruction)

Both `docs/superpowers/plans/2026-10-13-payment-ledger-and-cod-alert.md` (plan) and this PR doc are **left UNTRACKED** — docs, not product code. Final `git status` must show only these two untracked files with a clean index. This file is intentionally NOT added to the branch.
