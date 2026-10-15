import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from '../courier-webhook.service';
import { CourierManagerService } from '../courier-manager.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { CourierSettlementImportService } from '../../courier-settlement/courier-settlement-import.service';
import { mapCourierStatusToDispatchStatus } from '../courier-status-mapper';
import { DispatchStatus } from '@prisma/client';

/**
 * Task 1 (final follow-up, owner-locked): paid = DELIVERED + Delivered + money.
 *
 * Owner lock (paid→money-only DEAD/withdrawn):
 * - paid = DELIVERED + Delivered + money identifiers, ALL 3 paid couriers.
 * - NO MONEY status anywhere.
 * - Money identifiers: pathao invoice_id, redx invoice_number, carrybee paid
 *   payload fields → timeline + WebhookAttempt meta (existing pattern, no new
 *   table). Amount ONLY if definite.
 * - Idempotent vs CSV: reuse settlement dedupe (webhook books NO payment;
 *   CSV books exactly one) — test paid + CSV → single payment.
 * - Steadfast unchanged (no per-parcel paid).
 *
 * Doc sources (API facts):
 * - Pathao "Webhook Integration Guide" order.paid sample:
 *   { consignment_id, merchant_order_id, event: "order.paid",
 *     invoice_id: "121224IBW19790" } — NO amount (identifiers only).
 * - Carrybee mirrors the Pathao order.* vocabulary (same dispatch map);
 *   details shape carries invoice_id + payment_status + collected_amount —
 *   handler records all three defensively, amount only if definite numeric.
 * - RedX paid carries tracking_number + invoice_number (+ message_en).
 *
 * RED first: redx paid advances nothing today; invoice dropped on
 * pathao/carrybee; sync mapper redx plain 'paid' is null.
 */
describe('Courier Task 1 — paid means delivered + money recording', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;

  const shippingOrder = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    timeline: [],
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'INV-1',
    courierService: 'pathao',
    trashedAt: null,
  };

  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };

  function timelineEntries(): any[] {
    const calls = (prisma.order.update as jest.Mock).mock.calls as any[];
    const withTimeline = calls.filter((c) => Array.isArray(c[0]?.data?.timeline));
    return withTimeline.flatMap((c) => c[0].data.timeline);
  }

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(shippingOrder),
        findUnique: jest.fn().mockResolvedValue(shippingOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.name === 'Delivered') return Promise.resolve(deliveredStatus);
          return Promise.resolve(null);
        }),
      },
      dispatch: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: any) => cb({})),
    };
    ordersService = { updateStatus: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: { getSteadfastReturnStatus: jest.fn() } },
        { provide: CancelReturnStockService, useValue: { restoreForOrder: jest.fn() } },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('sync mapper — paid → DELIVERED (all 3 paid couriers)', () => {
    it('pathao order.paid → DELIVERED', () => {
      expect(mapCourierStatusToDispatchStatus('pathao', 'order.paid')).toBe('DELIVERED');
    });

    it('carrybee order.paid → DELIVERED', () => {
      expect(mapCourierStatusToDispatchStatus('carrybee', 'order.paid')).toBe('DELIVERED');
    });

    it('redx plain paid → DELIVERED', () => {
      expect(mapCourierStatusToDispatchStatus('redx', 'paid')).toBe('DELIVERED');
    });

    it('pathao/carrybee plain paid → DELIVERED (tracking-API parity)', () => {
      expect(mapCourierStatusToDispatchStatus('pathao', 'paid')).toBe('DELIVERED');
      expect(mapCourierStatusToDispatchStatus('carrybee', 'paid')).toBe('DELIVERED');
    });
  });

  describe('pathao paid → DELIVERED + invoice_id recorded', () => {
    it('advances dispatch DELIVERED + order Delivered', async () => {
      const result = await service.handlePathao({
        event: 'order.paid',
        consignment_id: 'CG-1',
        merchant_order_id: 'INV-1',
        invoice_id: '121224IBW19790',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-delivered' },
        'system',
      );
    });

    it('records invoice_id on the timeline (settlement-matching key, no new table)', async () => {
      await service.handlePathao({
        event: 'order.paid',
        consignment_id: 'CG-1',
        merchant_order_id: 'INV-1',
        invoice_id: '121224IBW19790',
      });

      const entries = timelineEntries();
      const paid = entries.find((e) => e?.courier === 'pathao' && e?.status === 'DELIVERED');
      expect(paid).toBeDefined();
      expect(JSON.stringify(paid)).toContain('121224IBW19790');
    });

    it('books NO payment row (amount absent → identifiers only; CSV owns the money)', async () => {
      await service.handlePathao({
        event: 'order.paid',
        consignment_id: 'CG-1',
        merchant_order_id: 'INV-1',
        invoice_id: '121224IBW19790',
      });

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('carrybee paid → DELIVERED + money fields', () => {
    it('advances dispatch DELIVERED + order Delivered', async () => {
      const result = await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-CB-1',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-delivered' },
        'system',
      );
    });

    it('records invoice_id on the timeline (settlement-matching key)', async () => {
      await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-CB-1',
      });

      const entries = timelineEntries();
      const paid = entries.find((e) => e?.courier === 'carrybee' && e?.status === 'DELIVERED');
      expect(paid).toBeDefined();
      expect(JSON.stringify(paid)).toContain('INV-CB-1');
    });

    it('records a definite collected_amount; absent amount stays absent', async () => {
      await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-CB-1',
        collected_amount: 500,
      });
      let entries = timelineEntries();
      expect(JSON.stringify(entries)).toContain('500');

      (prisma.order.update as jest.Mock).mockClear();
      await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-CB-2',
      });
      entries = timelineEntries();
      const last = entries[entries.length - 1] || {};
      expect((last as any)?.collectedAmount).toBeUndefined();
    });

    it('books NO payment row (CSV owns the money)', async () => {
      await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-CB-1',
      });

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('redx paid → DELIVERED + Delivered + invoice (CHANGE from money-only)', () => {
    const paidBody = {
      tracking_number: 'TN-1',
      invoice_number: 'INV-1',
      status: 'paid',
    };

    it('advances dispatch DELIVERED (was: no delivery change)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      const result = await service.handleRedx(paidBody);

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('advances the order to Delivered (was: never advances)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      await service.handleRedx(paidBody);

      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-delivered' },
        'system',
      );
    });

    it('keeps the money recording (invoice_number on timeline)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      await service.handleRedx(paidBody);

      const entries = timelineEntries();
      const paid = entries.find(
        (e) => e?.courier === 'redx' && e?.status === 'DELIVERED',
      );
      expect(paid).toBeDefined();
      expect(paid?.invoiceNumber).toBe('INV-1');
    });

    it('books NO payment row (CSV owns the money — paid + CSV → single payment)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      await service.handleRedx(paidBody);

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('no MONEY status anywhere (owner lock)', () => {
    it('DispatchStatus enum has no MONEY value', () => {
      expect(Object.keys(DispatchStatus)).not.toContain('MONEY');
      expect(Object.values(DispatchStatus)).not.toContain('MONEY' as any);
    });

    it('paid handlers never write a MONEY dispatch status', async () => {
      await service.handlePathao({
        event: 'order.paid',
        consignment_id: 'CG-1',
        invoice_id: '121224IBW19790',
      });
      await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        invoice_id: 'INV-CB-1',
      });
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });
      await service.handleRedx({
        tracking_number: 'TN-1',
        invoice_number: 'INV-1',
        status: 'paid',
      });

      const upserts = (prisma.dispatch.upsert as jest.Mock).mock.calls as any[];
      expect(upserts.length).toBeGreaterThan(0);
      for (const [args] of upserts) {
        expect(args?.update?.status).not.toBe('MONEY');
        expect(args?.create?.status).not.toBe('MONEY');
      }
      const updates = (prisma.dispatch.update as jest.Mock).mock.calls as any[];
      for (const [args] of updates) {
        expect(args?.data?.status).not.toBe('MONEY');
      }
    });
  });

  describe('steadfast unchanged (no per-parcel paid)', () => {
    it('sync mapper returns null for paid labels', () => {
      expect(mapCourierStatusToDispatchStatus('steadfast', 'paid')).toBeNull();
      expect(mapCourierStatusToDispatchStatus('steadfast', 'order.paid')).toBeNull();
    });
  });

  describe('definitePaidAmount gate — finite number > 0 only', () => {
    it('rejects 0 / negative / NaN / non-numeric (returns null)', () => {
      const gate = (service as any).definitePaidAmount.bind(service);
      expect(gate({ collected_amount: 0 })).toBeNull();
      expect(gate({ collected_amount: -1 })).toBeNull();
      expect(gate({ collected_amount: -500 })).toBeNull();
      expect(gate({ collected_amount: '0' })).toBeNull();
      expect(gate({ amount: 0 })).toBeNull();
      expect(gate({ cash_collected: -10 })).toBeNull();
      expect(gate({ cash_paid: NaN })).toBeNull();
      expect(gate({ collected_amount: 'abc' })).toBeNull();
      expect(gate({ collected_amount: null })).toBeNull();
      expect(gate({ collected_amount: undefined })).toBeNull();
    });

    it('rejects booleans / arrays / objects / blank strings (returns null)', () => {
      const gate = (service as any).definitePaidAmount.bind(service);
      expect(gate({ collected_amount: true as any })).toBeNull();
      expect(gate({ collected_amount: false as any })).toBeNull();
      expect(gate({ collected_amount: [] as any })).toBeNull();
      expect(gate({ collected_amount: [500] as any })).toBeNull();
      expect(gate({ collected_amount: {} as any })).toBeNull();
      expect(gate({ collected_amount: '   ' })).toBeNull();
      expect(gate({ collected_amount: '' })).toBeNull();
      expect(gate({ amount: true as any })).toBeNull();
      expect(gate({ cash_paid: [] as any })).toBeNull();
    });

    it('accepts finite numbers > 0 (number or numeric string)', () => {
      const gate = (service as any).definitePaidAmount.bind(service);
      expect(gate({ collected_amount: 1 })).toBe(1);
      expect(gate({ collected_amount: 500 })).toBe(500);
      expect(gate({ collected_amount: 770.5 })).toBe(770.5);
      expect(gate({ collected_amount: '500' })).toBe(500);
      expect(gate({ collected_amount: '  500  ' })).toBe(500);
      expect(gate({ amount: 250 })).toBe(250);
      expect(gate({ cash_collected: 300 })).toBe(300);
      expect(gate({ cash_paid: '400' })).toBe(400);
    });
  });

  describe('pathao/carrybee collected_amount rides the SAME definite gate', () => {
    it('pathao order.paid with 0/negative/boolean/array/blank records NO collectedAmount', async () => {
      for (const bad of [0, -5, true, [], '   '] as any[]) {
        (prisma.order.update as jest.Mock).mockClear();
        await service.handlePathao({
          event: 'order.paid',
          consignment_id: 'CG-1',
          merchant_order_id: 'INV-1',
          invoice_id: 'INV-X',
          collected_amount: bad,
        });
        const entries = timelineEntries();
        const last = entries[entries.length - 1] || {};
        expect((last as any)?.collectedAmount).toBeUndefined();
      }
    });

    it('pathao order.paid with a definite amount records it', async () => {
      await service.handlePathao({
        event: 'order.paid',
        consignment_id: 'CG-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-X',
        collected_amount: 500,
      });
      const entries = timelineEntries();
      const last = entries[entries.length - 1] || {};
      expect((last as any)?.collectedAmount).toBe(500);
    });

    it('carrybee order.paid with 0/negative/boolean/array/blank records NO collectedAmount', async () => {
      for (const bad of [0, -5, true, [], '   '] as any[]) {
        (prisma.order.update as jest.Mock).mockClear();
        await service.handleCarrybee({
          event: 'order.paid',
          consignment_id: 'CBX-1',
          merchant_order_id: 'INV-1',
          invoice_id: 'INV-CB-X',
          collected_amount: bad,
        });
        const entries = timelineEntries();
        const last = entries[entries.length - 1] || {};
        expect((last as any)?.collectedAmount).toBeUndefined();
      }
    });

    it('carrybee order.paid with a definite amount records it', async () => {
      await service.handleCarrybee({
        event: 'order.paid',
        consignment_id: 'CBX-1',
        merchant_order_id: 'INV-1',
        invoice_id: 'INV-CB-X',
        collected_amount: 500,
      });
      const entries = timelineEntries();
      const last = entries[entries.length - 1] || {};
      expect((last as any)?.collectedAmount).toBe(500);
    });
  });

  describe('paid + CSV → single payment (settlement transactionId dedupe)', () => {
    it('paid webhook with invoice X then CSV containing X books exactly 1 payment row', async () => {
      const payments: any[] = [];
      prisma.payment.create.mockImplementation(async ({ data }: any) => {
        const row = { id: `pay-${payments.length + 1}`, ...data };
        payments.push(row);
        return row;
      });

      // 1. Paid webhook books NO payment (CSV owns the money).
      await service.handleRedx({
        tracking_number: 'TN-X',
        invoice_number: 'INV-X',
        status: 'paid',
        collected_amount: 770,
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(payments).toHaveLength(0);

      // 2. CSV import books ONE courier_settlement PAID row via the real
      // booking code (transactionId `<invoiceId>:<orderId>` dedupe).
      const tx: any = {
        payment: {
          findMany: async ({ where }: any) => {
            const wanted: string[] = where?.transactionId?.in ?? [];
            return payments.filter(
              (p) => wanted.includes(p.transactionId) && p.gatewayCode === 'courier_settlement',
            );
          },
          create: async ({ data }: any) => {
            const row = { id: `pay-${payments.length + 1}`, ...data };
            payments.push(row);
            return row;
          },
        },
        order: {
          findMany: async () => [
            { id: 'order-1', total: 1000, customerId: null, payments: [] },
          ],
        },
      };
      const importSvc = new CourierSettlementImportService(
        {} as any,
        { record: jest.fn() } as any,
      );
      const prepared: any = {
        rowRecords: [
          {
            row: { rowClass: 'DATA', rowKind: 'DELIVERY', effectiveCollected: 770 },
            match: { orderId: 'order-1' },
          },
        ],
      };
      const invoiceId = 'settlement-inv-1';
      await (importSvc as any).bookSettlementPayments(tx, invoiceId, 'redx', prepared, 'tester');

      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        orderId: 'order-1',
        gatewayCode: 'courier_settlement',
        amount: 770,
        status: 'PAID',
        transactionId: `${invoiceId}:order-1`,
      });

      // 3. CSV re-import (same batch+order) is skipped — still exactly 1.
      await (importSvc as any).bookSettlementPayments(tx, invoiceId, 'redx', prepared, 'tester');
      expect(payments).toHaveLength(1);
    });
  });
});
