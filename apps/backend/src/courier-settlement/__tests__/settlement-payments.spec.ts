// D-C settlement real rows: import commit writes one idempotent
// `courier_settlement` PAID payment per matched order (same $tx as the rows),
// so the ledger reflects money the courier actually collected. Re-import
// skips orders already booked for the batch (transactionId guard);
// over-settlement grants the marginal excess as customer credit.

import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CustomerCreditService } from '../../customer-credit/customer-credit.service';
import { CourierSettlementActivityService } from '../activity.service';
import { CourierSettlementImportService } from '../courier-settlement-import.service';

const FIXTURE = join(__dirname, '../parsing/__fixtures__/pathao.csv');
const CSV = readFileSync(FIXTURE);

// Fixture Merchant_Order_IDs: row2 → ORD-260925-0020 (collected 770),
// row3 → ORD-260925-0017 (collected 2755). Row1 is a fee row (0 collected),
// row4 references an order we deliberately leave unmatched.
const MATCHED_ORDERS: Record<string, any> = {
  'ORD-260925-0020': {
    id: 'o-20',
    displayId: 'ORD-260925-0020',
    courierConsignmentId: null,
    courierTrackingCode: null,
    paymentOptionType: 'CASH_ON_DELIVERY',
    trashedAt: null,
    total: 770,
    status: { name: 'Delivered' },
    payments: [],
  },
  'ORD-260925-0017': {
    id: 'o-17',
    displayId: 'ORD-260925-0017',
    courierConsignmentId: null,
    courierTrackingCode: null,
    paymentOptionType: 'CASH_ON_DELIVERY',
    trashedAt: null,
    total: 1000,
    status: { name: 'Delivered' },
    payments: [],
  },
};

// Due-facts view for the settlement-payment step (id → ledger facts).
const DUE_FACTS: Record<string, any> = {
  'o-20': { id: 'o-20', displayId: 'ORD-260925-0020', total: 770, customerId: null, payments: [] },
  'o-17': { id: 'o-17', displayId: 'ORD-260925-0017', total: 1000, customerId: 'cust-17', payments: [] },
};

function makePrisma(opts?: { existingSettlementTxns?: string[] }) {
  const invoices: any[] = [];
  const rows: any[] = [];
  const payments: any[] = [];
  let seq = 0;
  const existing = new Set(opts?.existingSettlementTxns ?? []);

  const tx: any = {
    orderCounter: {
      upsert: async ({ where }: any) => ({ date: where.date, seq: 1 }),
    },
    courierSettlementRow: {
      count: async ({ where }: any) => rows.filter((r) => r.invoiceId === where.invoiceId).length,
      createMany: async ({ data }: any) => {
        for (const d of data) rows.push({ id: `row-${++seq}`, ...d });
        return { count: data.length };
      },
      findMany: async ({ where }: any) =>
        rows
          .filter((r) => r.invoiceId === where?.invoiceId)
          .map((r) => ({ id: r.id, rowNumber: r.rowNumber })),
    },
    courierSettlementException: {
      createMany: async ({ data }: any) => ({ count: data.length }),
    },
    courierSettlementInvoice: {
      update: async ({ where, data }: any) => {
        const inv = invoices.find((i) => i.id === where.id);
        if (!inv) throw new Error('update: invoice not found');
        Object.assign(inv, data);
        return inv;
      },
    },
    order: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id) => DUE_FACTS[id]).filter(Boolean);
      },
    },
    payment: {
      findMany: async ({ where }: any) => {
        const wanted: string[] = where?.transactionId?.in ?? [];
        return wanted
          .filter((t) => existing.has(t))
          .map((t) => ({ id: `pay-${t}`, transactionId: t, gatewayCode: 'courier_settlement' }));
      },
      create: async ({ data }: any) => {
        const row = { id: `pay-${++seq}`, ...data };
        payments.push(row);
        return row;
      },
    },
  };

  const prisma: any = {
    $transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
    courierSettlementInvoice: {
      findFirst: async () => null,
      findUnique: async ({ where }: any) => {
        const inv = invoices.find((i) => i.id === where.id);
        return inv ? { ...inv } : null;
      },
      create: async ({ data }: any) => {
        const inv = { id: `inv-${++seq}`, createdAt: new Date(), isRevision: false, ...data };
        invoices.push(inv);
        return inv;
      },
      update: tx.courierSettlementInvoice.update,
      updateMany: async () => ({ count: 1 }),
    },
    courierSettlementColumnAlias: { findMany: async () => [] },
    // previousSettlements() during analyze: no prior finalized settlements here.
    courierSettlementRow: { findMany: async () => [] },
    dispatch: { findMany: async () => [] },
    order: {
      findMany: async () => Object.values(MATCHED_ORDERS),
    },
    orderCounter: tx.orderCounter,
  };

  return { prisma, invoices, rows, payments, existing };
}

async function makeService(opts?: { existingSettlementTxns?: string[]; credit?: any }) {
  const db = makePrisma(opts);
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const credit = opts?.credit ?? { grantFromOverpayment: jest.fn().mockResolvedValue(null) };
  // Same convention as import-flow.spec: analyze stores bytes via storage,
  // commit re-reads them — no storeFile:false / knownBuffer shortcut.
  const storage = {
    store: jest.fn(async (key: string) => `uploads/${key}`),
    readMediaOriginal: jest.fn(async () => CSV),
  };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementImportService,
      { provide: PrismaService, useValue: db.prisma },
      { provide: CourierSettlementActivityService, useValue: activity },
      { provide: CustomerCreditService, useValue: credit },
      { provide: StorageService, useValue: storage },
      { provide: getQueueToken('courier-settlement-import'), useValue: { add: jest.fn() } },
    ],
  }).compile();

  return { svc: mod.get(CourierSettlementImportService), db, activity, credit };
}

const input = () => ({
  buffer: CSV,
  filename: 'pathao.csv',
  mimeType: 'text/csv',
  actor: 'tester',
});

describe('settlement real payment rows (D-C)', () => {
  it('commit writes one courier_settlement PAID row per matched order with collected > 0', async () => {
    const { svc, db } = await makeService();
    const draft = await svc.analyze(input());
    const inv = db.invoices.find((i: any) => i.id === draft.invoiceId);

    await svc.commit(draft.invoiceId, 'tester');

    expect(db.payments).toHaveLength(2);
    const byOrder = Object.fromEntries(db.payments.map((p: any) => [p.orderId, p]));
    expect(byOrder['o-20']).toMatchObject({
      gatewayCode: 'courier_settlement',
      account: inv.courier,
      amount: 770,
      status: 'PAID',
      transactionId: `${draft.invoiceId}:o-20`,
    });
    expect(byOrder['o-17']).toMatchObject({
      gatewayCode: 'courier_settlement',
      amount: 2755,
      status: 'PAID',
      transactionId: `${draft.invoiceId}:o-17`,
    });
    // The fee row (0 collected) and the unmatched row book nothing.
    for (const p of db.payments) {
      expect(Number(p.amount)).toBeGreaterThan(0);
      expect(p.recordedAt).toBeInstanceOf(Date);
    }
  });

  it('commit skips orders already booked for the batch (idempotent per batch+order)', async () => {
    const { svc, db } = await makeService();
    const draft = await svc.analyze(input());
    // A row booked by an earlier attempt of the SAME batch (same invoice id):
    // the pre-check skips it, the other order still books.
    db.existing.add(`${draft.invoiceId}:o-20`);

    await svc.commit(draft.invoiceId, 'tester');

    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({
      orderId: 'o-17',
      amount: 2755,
      transactionId: `${draft.invoiceId}:o-17`,
    });
  });

  it('over-settlement grants the marginal excess as customer credit; guest orders never grant', async () => {
    const credit = { grantFromOverpayment: jest.fn().mockResolvedValue({ id: 'cc-1' }) };
    const { svc } = await makeService({ credit });
    const draft = await svc.analyze(input());
    await svc.commit(draft.invoiceId, 'tester');

    // o-17: total 1000, settled 2755 → marginal excess 1755 granted.
    expect(credit.grantFromOverpayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerId: 'cust-17',
        orderId: 'o-17',
        orderTotal: 1000,
        paidBefore: 0,
        newAmount: 2755,
        isPaid: true,
      }),
    );
    // o-20 is a guest order (no customerId) → no grant call for it.
    const grantedOrderIds = credit.grantFromOverpayment.mock.calls.map((c: any[]) => c[1].orderId);
    expect(grantedOrderIds).toEqual(['o-17']);
  });
});
