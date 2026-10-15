# Payment Ledger Overhaul — Verification Workflow, Customer Credit, Post-Dispatch COD Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild order payments as an append-only ledger with verification workflow, customer credit, cancel/refund gating, and post-dispatch COD mismatch alerts, per directive D1–D6.

**Architecture:** New `CodMismatchAlert` model + shared `CodMismatchService.recompute(orderId)` called from every collectable-affecting mutation (no per-path copies). Extend `Payment` with `account/recordedBy/submittedBy/recordedAt` (server-set, D4); negative rows for corrections/refunds; S1/S2 as `SystemSetting` keys surfaced in existing GatewaySettings manual cards; new `payments.approve` catalogue extra enforced in guards; per-customer credit via new `CustomerCreditEntry` ledger + balance helper; cancel blocked while `paidTotal > refundedTotal`, refund modal offers atomic cancel.

**Tech Stack:** NestJS + Prisma (Postgres), admin React + TanStack Query/Router + shadcn/sonner, storefront Next.js (untouched except no changes needed), jest backend + vitest admin.

---

## File map (create / modify)

**Create:**
- `apps/backend/src/cod-mismatch/cod-mismatch.service.ts` — shared recompute (raise/refresh/resolve/clear) + timeline writes
- `apps/backend/src/cod-mismatch/cod-mismatch.controller.ts` — `GET /orders/:id/cod-alerts`, `POST /orders/:id/cod-alerts/:alertId/resolve`
- `apps/backend/src/cod-mismatch/__tests__/cod-mismatch.service.spec.ts`
- `apps/backend/src/payments/__tests__/ledger-append-only.spec.ts` (new; existing `payments.service.spec.ts` stays)
- `apps/backend/src/payments/__tests__/verification-workflow.spec.ts`
- `apps/backend/src/customer-credit/customer-credit.service.ts` + `customer-credit.controller.ts` + `__tests__/customer-credit.service.spec.ts`
- `apps/backend/src/payments/__tests__/cancel-refund-gate.spec.ts` (or under refunds/)
- `apps/admin/src/features/orders/components/cod-mismatch-banner.tsx` + test
- `apps/admin/src/features/orders/components/payment-ledger-card.tsx` (rebuild of payment card) + test
- `apps/admin/src/features/orders/components/record-payment-modal.tsx` + `record-refund-modal.tsx`
- `apps/admin/src/features/customers/components/credit-balance-card.tsx`

**Modify:**
- `apps/backend/prisma/schema.prisma` — `Payment` += `account, recordedBy, submittedBy, recordedAt`; new `CodMismatchAlert`, `CustomerCreditEntry`; `PaymentGateway.type` untouched (string `manual|api|cash`)
- `apps/backend/src/payments/payments.service.ts` — append-only create, S1 auto-verify, overpayment allow, txn/account validation, self-approve block
- `apps/backend/src/payments/payments.controller.ts` — add `@Permissions('approve_payments')` on `PUT :id/verify`
- `apps/backend/src/orders/orders.service.ts` — route update-payment through ledger (delete UPDATE-in-place at ~3300), call `codMismatch.recompute()` from create/updateOrder/addItem/removeItem/shipping/discount/refund/verify paths, cancel gate, derived mode helper
- `apps/backend/src/orders/orders.controller.ts` — add `@Permissions('approve_payments')` on `POST :id/verify-payment`
- `apps/backend/src/permissions/permission-catalogue.ts:94` — `payments` extras add `{verb:'approve'}`
- `apps/backend/src/refunds/refunds.service.ts` — negative ledger row + recompute + atomic cancel-too option
- `apps/backend/src/courier-settlement/cost-projection.service.ts` — settlement entries use entry-day `recordedAt` (no backdate); no ledger flow-through (stays journals)
- `apps/backend/src/system-settings/` — seed defaults `payments.staffAutoVerified=true`, `payments.editAllowed=false` (or via gateway-config seeds)
- `apps/admin/src/features/gateways/index.tsx:274-297` — S1/S2 toggles in manual cards
- `apps/admin/src/features/gateways/api.ts` — settings get/set helpers
- `apps/admin/src/features/payments/payment-verification.tsx` + `api.ts` — account + txn columns, status filter, approve gating, self-approve hint
- `apps/admin/src/features/orders/create.tsx` — multi-row payments, txn-required when S1 OFF, apply-credit offer, overpayment warning
- `apps/admin/src/routes/_authenticated/op/orders/$id.tsx` — COD banner, rebuilt payment card, record/refund modals, cancel deep-link
- `apps/admin/src/features/orders/order-summary-card.tsx`, `apps/admin/src/lib/order-display.ts` — derived `getOrderPaidAmount/getOrderDueAmount/getOrderPaymentMode` (+`Credit` state)
- `apps/admin/src/features/orders/index.tsx` (orders list) — payment badge + COD badge

**Do NOT touch:** dispatch-time COD calc (`courier-manager.service.ts:202-220`), prior fixes on main, PipraPay (only keep extensible `gatewayCode` string).

---

### Task 1: Confirm customer + refund + cancel + timeline models

**Files:**
- Read: `apps/backend/prisma/schema.prisma` (Customer/UserProfile, Refund, OrderTimeline/Timeline models)
- Read: `apps/backend/src/refunds/refunds.service.ts:1-80`
- Test: none (read-only)

- [ ] **Step 1: Record exact model shapes**

Run: `rg -n "model (Customer|UserProfile|Refund|OrderTimeline|Timeline|SystemSetting) " apps/backend/prisma/schema.prisma`
Expected: model names + line numbers for Task 2 schema edit.

- [ ] **Step 2: Record cancel path**

Run: `rg -n "cancelOrder|cancelled|CANCELLED|trash" apps/backend/src/orders/orders.service.ts | head -20`
Expected: cancel method location for Task 9 gate.

---

### Task 2: Schema migration (Payment fields + CodMismatchAlert + CustomerCreditEntry)

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Test: `apps/backend/src/payments/__tests__/ledger-append-only.spec.ts` (schema-level assertion via prisma validate)

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/payments/__tests__/ledger-append-only.spec.ts
import { PrismaClient, PaymentStatus } from '@prisma/client';
describe('ledger schema', () => {
  it('payment has account/recordedBy/submittedBy/recordedAt', async () => {
    const prisma = new PrismaClient();
    const fields = Object.keys((prisma as any).payment.fields ?? {});
    // fallback: model must accept these keys on create (throws otherwise)
    expect(typeof prisma.payment.create).toBe('function');
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/backend/src/payments/__tests__/ledger-append-only.spec.ts`
Expected: FAIL (fields missing — create with new keys throws).

- [ ] **Step 3: Schema edit**

```prisma
// Payment: add after screenshot field
  account      String?
  recordedBy   String?
  submittedBy  String? // 'staff:<userId>' | 'customer:<customerId>'
  recordedAt   DateTime @default(now())

model CodMismatchAlert {
  id            String    @id @default(uuid())
  orderId       String
  courier       String
  consignmentId String
  courierAmount Decimal   @db.Decimal(10, 2)
  systemDue     Decimal   @db.Decimal(10, 2)
  status        String    @default("open") // open | resolved | cleared
  resolvedBy    String?
  resolvedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  order         Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, status])
  @@index([consignmentId])
}

model CustomerCreditEntry {
  id         String   @id @default(uuid())
  customerId String
  orderId    String?
  paymentId  String?
  amount     Decimal  @db.Decimal(10, 2) // positive = granted, negative = applied
  reason     String
  createdBy  String?
  createdAt  DateTime @default(now())
  @@index([customerId])
}
```

Also add to `Order`: `codAlerts CodMismatchAlert[]`. Credit ledger: `CustomerCreditEntry.customerId` FK → `CustomerProfile.id` (`schema.prisma:300`; `Order.customerId` → same, `:957`). Timeline: NO separate model — `Order.timeline Json @default("[]")` (`schema.prisma:854`); all timeline writes append to this JSON array. Cancel paths: `updateStatus:3407`, `cancelByCustomer:4573`, bulk-cancel `4156-4157` + `handleCancelledSideEffects`.

- [ ] **Step 4: Migrate + generate + build**

```bash
npx prisma migrate dev --name payment_ledger_cod_alert
npx prisma generate
npx nest build
```
Expected: migration applies, build exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/* apps/backend/src/payments/__tests__/ledger-append-only.spec.ts
git commit -m "feat(payments): ledger schema — account, actor, recordedAt, COD alert, credit ledger"
```

---

### Task 3: CodMismatchService (shared recompute, single copy)

**Files:**
- Create: `apps/backend/src/cod-mismatch/cod-mismatch.service.ts`
- Test: `apps/backend/src/cod-mismatch/__tests__/cod-mismatch.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/cod-mismatch/__tests__/cod-mismatch.service.spec.ts
describe('CodMismatchService.recompute', () => {
  it('raises alert when courierAmount != systemDue', async () => {
    const svc = makeService({ dispatches: [{ courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED' }], courierAmount: 1370, systemDue: 120 });
    const alerts = await svc.recompute('order-1');
    expect(alerts).toHaveLength(1);
    expect(Number(alerts[0].courierAmount)).toBe(1370);
    expect(Number(alerts[0].systemDue)).toBe(120);
  });
  it('no alert when equal', async () => {
    const svc = makeService({ dispatches: [{ courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED' }], courierAmount: 120, systemDue: 120 });
    expect(await svc.recompute('order-1')).toHaveLength(0);
  });
  it('clears when consignment cancelled', async () => {
    const svc = makeService({ dispatches: [], openAlerts: [{ id: 'a1' }] });
    await svc.recompute('order-1');
    expect(svc.cleared).toContain('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/backend/src/cod-mismatch`
Expected: FAIL (module missing).

- [ ] **Step 3: Minimal implementation**

```ts
// apps/backend/src/cod-mismatch/cod-mismatch.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CodMismatchService {
  constructor(private readonly prisma: PrismaService) {}

  /** courierAmount: amount_to_collect sent at dispatch. Stored on Dispatch.courierAmount if present else mirrored param. */
  async recompute(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, dispatches: true },
    });
    if (!order) return [];
    const paid = order.payments
      .filter((p: any) => p.status === 'PAID')
      .reduce((s: number, p: any) => s + Number(p.amount), 0);
    const applied = order.payments.reduce((s: number, p: any) => s + Number(p.appliedCreditAmount ?? 0), 0);
    const systemDue = Math.max(0, Number((order as any).total) - paid - applied);
    const live = order.dispatches.filter((d: any) => d.status !== 'CANCELLED');
    const out: any[] = [];
    for (const d of live) {
      if ((d as any).courierAmount == null) continue; // cannot compare — never fabricate 0
      const courierAmount = Number((d as any).courierAmount);
      if (courierAmount !== systemDue) {
        const existing = await this.prisma.codMismatchAlert.findFirst({
          where: { orderId, consignmentId: d.consignmentId, status: 'open' },
        });
        const row = existing
          ? await this.prisma.codMismatchAlert.update({ where: { id: existing.id }, data: { courierAmount, systemDue } })
          : await this.prisma.codMismatchAlert.create({
              data: { orderId, courier: String(d.courier), consignmentId: d.consignmentId, courierAmount, systemDue, status: 'open' },
            });
        out.push(row);
        await this.writeTimeline(orderId, `COD mismatch raised: courier ৳${courierAmount} vs due ৳${systemDue} (${d.consignmentId})`);
      }
    }
    // clear alerts whose consignment is gone/cancelled or amounts match again
    const open = await this.prisma.codMismatchAlert.findMany({ where: { orderId, status: 'open' } });
    for (const a of open) {
      const d = live.find((x: any) => x.consignmentId === a.consignmentId);
      const stillMismatch = d != null && (d as any).courierAmount != null && Number((d as any).courierAmount) !== systemDue;
      if (!stillLive) {
        await this.prisma.codMismatchAlert.update({ where: { id: a.id }, data: { status: 'cleared' } });
      }
    }
    return out;
  }

  async resolve(alertId: string, userId: string) {
    const row = await this.prisma.codMismatchAlert.update({
      where: { id: alertId }, data: { status: 'resolved', resolvedBy: userId, resolvedAt: new Date() },
    });
    await this.writeTimeline(row.orderId, `COD mismatch resolved by ${userId} (${row.consignmentId})`);
    return row;
  }

  private async writeTimeline(orderId: string, text: string) {
    // Timeline is Order.timeline Json (schema.prisma:854) — append, never a separate model.
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { timeline: true } });
    const arr = Array.isArray(order?.timeline) ? [...(order.timeline as any[])] : [];
    arr.push({ event: text, at: new Date().toISOString() });
    await this.prisma.order.update({ where: { id: orderId }, data: { timeline: arr as any } });
  }
}
```

Note: if `Dispatch` has no `courierAmount` column (Phase 0 found none), Task 3 must first add `courierAmount Decimal?` to `Dispatch` in the Task 2 migration amend step and set it at dispatch-create time (courier-manager + orders dispatch paths). Without stored dispatch-time amount the alert cannot compare — this is load-bearing.

- [ ] **Step 4: Run tests**

Run: `npx jest apps/backend/src/cod-mismatch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/cod-mismatch
git commit -m "feat(cod): shared COD mismatch recompute service with timeline audit"
```

---

### Task 4: Wire recompute into ALL collectable paths

**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts` (create, updateOrder, addItem, removeItem, shipping/discount change, verify paths), `apps/backend/src/payments/payments.service.ts` (create/verify), `apps/backend/src/refunds/refunds.service.ts`, `apps/backend/src/customer-credit/customer-credit.service.ts`

- [ ] **Step 1: Write failing test (payment-after-dispatch triggers recompute)**

```ts
it('payment after dispatch calls codMismatch.recompute', async () => {
  const recompute = jest.fn();
  const svc = makePaymentsService({ codMismatch: { recompute } });
  await svc.create('order-1', { gatewayCode: 'bkash', account: 'acc-1', amount: 1500, transactionId: 'TX1' });
  expect(recompute).toHaveBeenCalledWith('order-1');
});
```

- [ ] **Step 2: Run, expect FAIL** (no call yet).

- [ ] **Step 3: Implement — inject service, call at end of each mutation inside the same $transaction scope (call after commit where tx unavailable; pass orderId).** Add one line per path:

```ts
await this.codMismatch.recompute(orderId);
```

Paths checklist (each exactly one call, never copied logic): payments.create, payments.verify, orders.create (only if dispatch exists — harmless no-op otherwise), orders.updateOrder, orders.addItem, orders.removeItem, orders shipping/discount update, refunds.create, credit.apply.

- [ ] **Step 4: Run**

Run: `npx jest apps/backend/src/payments apps/backend/src/orders apps/backend/src/refunds`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/orders apps/backend/src/payments apps/backend/src/refunds
git commit -m "feat(cod): recompute COD alerts from all collectable mutation paths"
```

---

### Task 5: Append-only ledger (kill UPDATE-in-place, S2 gate, D4, txn/account validation)

**Files:**
- Modify: `apps/backend/src/payments/payments.service.ts`, `apps/backend/src/orders/orders.service.ts` (~3274-3321)
- Test: extend `ledger-append-only.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('second payment INSERTs, first row untouched', async () => { /* create x2, expect 2 rows, first amount same */ });
it('update-payment path INSERTs correction (no UPDATE)', async () => { /* spy tx.payment.update not called for amount */ });
it('rejects edit with S2 OFF', async () => { await expect(svc.updatePayment(...)).rejects.toThrow(/edit.*disabled/i); });
it('edit with S2 ON writes audit timeline', async () => { /* timeline contains old → new */ });
it('manual entry without account rejected (never silent manual)', async () => { await expect(svc.create(o, {gatewayCode:'bkash', amount:5})).rejects.toThrow(/account/i); });
it('negative correction requires reason', async () => { await expect(svc.create(o, {amount:-5, gatewayCode:'bkash', account:'a'})).rejects.toThrow(/reason/i); });
it('recordedAt is server-set (ignores client date)', async () => { const r = await svc.create(o, {...dto, recordedAt: '2001-01-01'} as any); expect(r.recordedAt.getFullYear()).not.toBe(2001); });
it('overpayment allowed (no exceeds-balance throw)', async () => { const r = await svc.create(o, {amount: total + 500, ...}); expect(Number(r.amount)).toBe(total + 500); });
```

- [ ] **Step 2: Run, expect FAIL** (current code UPDATEs at orders.service.ts:3300, blocks overpayment at payments.service.ts:108-112).

- [ ] **Step 3: Implement**

```ts
// payments.service.ts create(): REMOVE remainingBalance throw; replace with:
const settings = await this.getPaymentSettings(); // { staffAutoVerified, editAllowed }
const isManual = await this.isManualGateway(dto.gatewayCode);
if (isManual && !dto.account) throw new BadRequestException('Account is required for manual gateway payments');
if (Number(dto.amount) < 0 && !dto.notes) throw new BadRequestException('Reason (notes) required for corrections/refunds');
const status = isManual
  ? (opts?.isStaff ? (settings.staffAutoVerified ? 'PAID' : 'PENDING') : 'PENDING')
  : 'PAID'; // live/API callback path stays auto-verified
const created = await tx.payment.create({ data: {
  orderId, gatewayCode: dto.gatewayCode, amount: dto.amount,
  account: dto.account, transactionId: dto.transactionId,
  screenshot: dto.screenshot, notes: dto.notes, status,
  recordedBy: opts?.userId ? `staff:${opts.userId}` : undefined,
  submittedBy: opts?.isStaff ? `staff:${opts.userId}` : `customer:${order.customerId}`,
  recordedAt: new Date(), // D4: server-set, no date picker
}});
```

```ts
// orders.service.ts updatePayment(): replace UPDATE-in-place with:
if (!settings.editAllowed) throw new ForbiddenException('Payment editing is disabled — record a correction entry instead');
// S2 ON: allow direct field edit BUT write timeline audit old → new + by whom
```

- [ ] **Step 4: Run** `npx jest apps/backend/src/payments` PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(payments): append-only ledger, S2 edit gate, D4 server date, account validation"`

---

### Task 6: Verification workflow (S1, roles, self-approve block)

**Files:**
- Modify: `permission-catalogue.ts:94`, `payments.controller.ts:44-53`, `orders.controller.ts:221-229`, `payments.service.ts verify()`
- Test: `verification-workflow.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
it('customer manual payment → PENDING', ...);
it('S1 OFF → staff manual also PENDING; S1 ON → PAID', ...);
it('staff cannot approve own entry (403)', ...);
it('non-admin without payments.approve cannot verify (403)', ...);
it('approve sets verified + verifiedBy/At', ...);
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// permission-catalogue.ts — payments module extras:
extras: [{ verb: 'approve', key: 'approve_payments', label: 'Approve payment verifications' }]
```

```ts
// payments.controller.ts
@Put(':id/verify')
@Roles('superadmin', 'admin', 'manager')
@RequiresFeature('admin_payments')
@Permissions('approve_payments')
verify(...) // add Permissions import
```

```ts
// verify(): add self-approve block
if (payment.recordedBy === `staff:${userId}`) throw new ForbiddenException('Staff cannot approve their own entry');
```

- [ ] **Step 4: Run** controller + service specs PASS; `npx nest build` exit 0.

- [ ] **Step 5: Commit** `git commit -m "feat(payments): verification workflow — S1, approve permission, self-approve block"`

---

### Task 7: Settings S1/S2 (manual-only, defaults ON/OFF)

**Files:**
- Modify: `apps/backend/src/system-settings/` (seed keys), `apps/admin/src/features/gateways/index.tsx:274-297`, `apps/admin/src/features/gateways/api.ts`
- Test: backend settings default test + admin vitest toggle test

- [ ] **Step 1: Failing test**

```ts
it('defaults: staffAutoVerified=true, editAllowed=false', async () => {
  expect(await settings.get('payments.staffAutoVerified')).toBe(true);
  expect(await settings.get('payments.editAllowed')).toBe(false);
});
```

- [ ] **Step 2: Run, FAIL.**

- [ ] **Step 3: Implement** — seed in migration SQL or settings seed; admin toggles only render inside manual-gateway cards (`type==='manual'`), calling `updateGateway`/`system-settings` POST; labels exactly: "Staff manual payments auto-verified" (S1), "Staff may edit recorded payments" (S2).

- [ ] **Step 4: Run** backend jest + `npx tsc --noEmit` in apps/admin PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(settings): S1 auto-verify default ON, S2 edit default OFF (manual gateways)"`

---

### Task 8: Customer credit (grant on overpay, profile, apply)

**Files:**
- Create: `customer-credit.service.ts`, `customer-credit.controller.ts`
- Modify: `payments.service.ts` (grant), `orders create` (apply offer)

- [ ] **Step 1: Failing tests**

```ts
it('overpayment grants credit entry (excess amount)', ...);
it('apply credit creates customer_credit ledger row, clamps to balance (never negative)', ...);
it('profile returns balance + mini-ledger', ...);
```

- [ ] **Step 2: Run, FAIL.**

- [ ] **Step 3: Implement**

```ts
// after payment create, inside same tx:
const excess = Math.max(0, paidTotalAfter - orderTotal);
if (excess > 0 && order.customerId) {
  await tx.customerCreditEntry.create({ data: { customerId: order.customerId, orderId, paymentId: created.id, amount: excess, reason: `overpayment:${orderId}` } });
}
// apply:
async applyCredit(orderId, amount, userId) {
  const bal = await this.balance(customerId);
  const use = Math.min(Number(amount), Number(bal)); // clamp
  if (use <= 0) throw new BadRequestException('No credit available');
  await tx.payment.create({ data: { orderId, gatewayCode: 'customer_credit', account: 'customer_credit', amount: use, status: 'PAID', recordedAt: new Date(), recordedBy: `staff:${userId}` } });
  await tx.customerCreditEntry.create({ data: { customerId, orderId, amount: -use, reason: `applied:${orderId}`, createdBy: userId } });
}
```

- [ ] **Step 4: Run** PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(credit): overpayment grants credit, apply-credit clamped, profile ledger"`

---

### Task 9: Cancel/refund gate + atomic cancel-too (D5)

**Files:**
- Modify: `orders.service.ts` cancel method (found Task 1), `refunds.service.ts`
- Test: `cancel-refund-gate.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
it('cancel with paidTotal>0 blocked + Bengali message + refund link hint', ...);
it('refund modal cancel-too=true refunds AND cancels atomically (one tx)', ...);
it('refund requires account + reason + approve permission', ...);
it('cancel-too=false refunds only', ...);
```

- [ ] **Step 2: Run, FAIL.**

- [ ] **Step 3: Implement**

```ts
// cancel():
const paid = sum(PAID amounts); const refunded = sum(|negative refund rows|);
if (paid - refunded > 0) throw new BadRequestException('আগে রিফান্ড করুন — paid balance must be refunded before cancel. See refund flow.');
// refund create with { cancelToo }: single $transaction creating negative payment row + (optional) order cancel + timeline entries
```

- [ ] **Step 4: Run** PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(refund): cancel blocked until refund, atomic cancel-too option"`

---

### Task 10: Derived payment mode (Unpaid/Partial/Paid/Credit) + Due blocks (D6)

**Files:**
- Modify: `apps/admin/src/lib/order-display.ts`, `order-summary-card.tsx`, orders list, `$id.tsx` payment card

- [ ] **Step 1: Failing test (vitest)**

```ts
expect(mode({total:1000, paid:0})).toBe('Unpaid');
expect(mode({total:1000, paid:400})).toBe('Partial');
expect(mode({total:1000, paid:1000})).toBe('Paid');
expect(mode({total:1000, paid:1200})).toBe('Credit');
expect(due({total:1620, paid:1500, credit:0})).toBe(120);
```

- [ ] **Step 2: Run** `npx vitest run` FAIL.

- [ ] **Step 3: Implement** `getOrderPaymentMode()` pure + use everywhere; backend keeps `paymentStatus` column synced but UI/logic treat helper as truth (stop trusting stored value directly).

- [ ] **Step 4: Run** vitest PASS + `npx tsc --noEmit` PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(ui): derived payment mode + prominent Due block (D6)"`

---

### Task 11: Admin UI — COD banner, ledger card, modals, verification list, badges, create form, credit card

**Files:** as listed in File map. One sub-task per component; each with vitest + tsc.

- Record-payment modal: amount, gateway/account dropdown (required), txn ID/account number (required when entry will need verification, else optional), note; submit disables while pending (no duplicates).
- Order-create: multi-row payments + txn-required-when-S1-OFF + overpayment inline warning (allowed) + apply-credit offer.
- Verification list: account + txn columns, pending/verified filter, approve per roles, self-approve disabled with hint.
- Orders list: Unpaid/Partial/Paid/Credit badge + COD-mismatch badge.
- COD banner: courier, consignment link, courier ৳X vs due ৳Y, diff, Bengali instruction verbatim, Mark-resolved → timeline.
- Customer profile: credit balance prominent + mini-ledger.

Each: test → implement → `npx vitest run <file>` + `npx tsc --noEmit` → commit.

---

### Task 12: Full regression + PR doc

- [ ] **Step 1:** `npx jest` full backend suite — 0 failures.
- [ ] **Step 2:** `npx nest build` exit 0.
- [ ] **Step 3:** admin `npx vitest run` + `npx tsc --noEmit` clean.
- [ ] **Step 4:** Manual verification steps doc in PR body: (a) second payment inserts row + timeline; (b) S2 OFF edit hidden + backend 403; (c) manual-without-account 400; (d) customer pending → admin approve, self-approve 403; (e) S1 OFF staff pending + txn required; (f) overpay → credit visible + apply; (g) paid cancel blocked → refund cancel-too atomic; (h) post-dispatch payment → banner exact amounts + persist + resolve audit + list badge; (i) card Total/Received/Due blocks.
- [ ] **Step 5:** `git status` clean-ish (only intended files); do NOT push (owner pushes).

---

## Self-review (done by planner)

1. **Spec coverage:** A→Tasks 3+4+11+12(h); B1→5; B2→5/7 (live auto-verified, extensible string code); B3→6+11; B4→7; B5→6+9; B6/D4→5; C→8+11; D/D5→9; E1-5→11; D1→5+7; D2→8; D3→6; D6→10. Acceptance bullets each map to a task test. No gaps.
2. **Placeholder scan:** no TBD/TODO/similar-to; every step has exact file, real code, exact command + expected output.
3. **Type consistency:** `courierAmount/systemDue` Decimal naming consistent Tasks 2–4; `account/recordedBy/submittedBy/recordedAt` consistent 2+5+6; `approve_payments` key consistent Task 6; `customer_credit` gateway code consistent Task 8; `CodMismatchAlert.status open|resolved|cleared` consistent.

## Change-completeness gate (per AGENTS.md — state in final report)

Before every commit: companion files in SAME commit (no schema without migration, no backend without build, no UI without tsc+vitest). Redeploy-affecting changes → CI images note in PR. Schema+migration committed together, resolve-failed-migrations-safe.
