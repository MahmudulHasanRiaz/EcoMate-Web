import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PosAnalyticsService } from '../pos-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

const D = (iso: string) => new Date(iso);

function sessionRow(over: Record<string, any> = {}) {
  return {
    id: 'sess-1',
    status: 'open',
    cashierId: 'cash-A',
    showroomId: 'sh-1',
    showroom: { id: 'sh-1', name: 'Gulshan', slug: 'gulshan', type: 'showroom' },
    cashier: { id: 'cash-A', firstName: 'Arif', lastName: 'Khan' },
    ...over,
  };
}

function payment(over: Record<string, any> = {}) {
  return {
    id: 'pay-1',
    status: 'PAID',
    amount: 1000,
    gatewayCode: 'CASH',
    verifiedAt: D('2026-09-10T10:00:00+06:00'),
    createdAt: D('2026-09-10T10:00:00+06:00'),
    ...over,
  };
}

function orderRow(over: Record<string, any> = {}) {
  return {
    id: 'ord-1',
    displayId: 'POS-260910-0001',
    createdAt: D('2026-09-10T10:00:00+06:00'),
    total: 1000,
    subtotal: 1000,
    discount: 0,
    paymentStatus: 'PAID',
    source: 'POS',
    trashedAt: null,
    assignedToId: null,
    guestName: null,
    guestPhone: null,
    customer: null,
    status: { name: 'Delivered' },
    posSessionId: 'sess-1',
    posSession: {
      cashierId: 'cash-A',
      cashier: { id: 'cash-A', firstName: 'Arif', lastName: 'Khan' },
    },
    payments: [payment()],
    refunds: [],
    items: [
      {
        quantity: 2,
        price: 500,
        product: { name: 'Tea' },
        variant: null,
        combo: null,
      },
    ],
    ...over,
  };
}

describe('PosAnalyticsService', () => {
  let svc: PosAnalyticsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosAnalyticsService,
        {
          provide: PrismaService,
          useValue: {
            posSession: { findUnique: jest.fn() },
            order: { findMany: jest.fn() },
          },
        },
      ],
    }).compile();
    svc = module.get(PosAnalyticsService);
    prisma = module.get(PrismaService);
    (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
  });

  afterEach(() => jest.clearAllMocks());

  function mockOrders(rows: any[]) {
    (prisma.order.findMany as jest.Mock)
      .mockResolvedValueOnce(rows)
      .mockResolvedValue([]);
  }

  const req = (query: Record<string, any> = {}, extra: Record<string, any> = {}) => ({
    sessionId: 'sess-1',
    userId: 'cash-A',
    query: { scope: 'showroom', preset: 'custom', from: '2026-09-01', to: '2026-09-30', ...query } as any,
    ...extra,
  });

  describe('scope guards', () => {
    it('rejects a forged showroomId with 400', async () => {
      await expect(
        svc.getOverview(req({}, { forgedShowroomId: 'sh-evil' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing session header with 400', async () => {
      await expect(
        svc.getOverview(req({}, { sessionId: undefined })),
      ).rejects.toThrow(/session/i);
    });

    it('rejects closed sessions with 400', async () => {
      (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
        sessionRow({ status: 'closed' }),
      );
      await expect(svc.getOverview(req())).rejects.toThrow(BadRequestException);
    });

    it('rejects sessions on non-showroom warehouses with 400', async () => {
      (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
        sessionRow({ showroom: { id: 'w-1', name: 'Main', slug: 'main', type: 'main' } }),
      );
      await expect(svc.getOverview(req())).rejects.toThrow(BadRequestException);
    });

    it('keeps other-showroom sales invisible', async () => {
      mockOrders([
        orderRow({ id: 'mine', displayId: 'POS-260910-0001' }),
        orderRow({ id: 'theirs', displayId: 'POS-260910-0002' }),
      ]);
      const res = await svc.getOverview(req());
      // fetch must constrain to the session showroom at the DB layer
      const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('sh-1');
      expect(res.data.totalOrders).toBe(2);
    });
  });

  describe('range validation', () => {
    it('rejects custom ranges over 366 days', async () => {
      await expect(
        svc.getOverview(req({ from: '2025-01-01', to: '2026-09-29' })),
      ).rejects.toThrow(/366/);
    });

    it('rejects from > to', async () => {
      await expect(
        svc.getOverview(req({ from: '2026-09-10', to: '2026-09-01' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves previous_month to the full prior Dhaka month', async () => {
      mockOrders([]);
      const res = await svc.getOverview(
        req({ preset: 'previous_month', from: undefined, to: undefined }),
      );
      expect(res.meta.range.from).toBe('2026-08-01');
      expect(res.meta.range.to).toBe('2026-08-31');
    });
  });

  describe('attribution', () => {
    it('my-sales follows the session cashier even after assignedToId reassignment', async () => {
      mockOrders([
        orderRow({ id: 'o1', assignedToId: 'manager-X' }),
        orderRow({ id: 'o2', posSession: { cashierId: 'cash-B', cashier: { firstName: 'Bo', lastName: '' } } }),
      ]);
      const mine = await svc.getTransactions(req({ scope: 'mine' }));
      expect(mine.data.map((r: any) => r.orderId)).toEqual(['o1']);
      (prisma.order.findMany as jest.Mock)
        .mockResolvedValueOnce([
          orderRow({ id: 'o1', assignedToId: 'manager-X' }),
          orderRow({ id: 'o2', posSession: { cashierId: 'cash-B', cashier: { firstName: 'Bo', lastName: '' } } }),
        ])
        .mockResolvedValue([]);
      const all = await svc.getTransactions(req({ scope: 'showroom' }));
      expect(all.data.map((r: any) => r.orderId).sort()).toEqual(['o1', 'o2']);
    });
  });

  describe('Dhaka midnight boundary', () => {
    it('buckets by payment-completion Dhaka day, not order creation', async () => {
      const late = orderRow({
        id: 'late',
        displayId: 'POS-260910-0002',
        createdAt: D('2026-09-09T23:30:00+06:00'),
        payments: [payment({ verifiedAt: D('2026-09-10T00:30:00+06:00'), createdAt: D('2026-09-10T00:30:00+06:00') })],
      });
      const early = orderRow({
        id: 'early',
        displayId: 'POS-260910-0001',
        createdAt: D('2026-09-10T00:10:00+06:00'),
        payments: [payment({ verifiedAt: null, createdAt: D('2026-09-09T23:50:00+06:00') })],
      });
      mockOrders([late, early]);
      const day10 = await svc.getTransactions(
        req({ from: '2026-09-10', to: '2026-09-10' }),
      );
      expect(day10.data.map((r: any) => r.orderId)).toEqual(['late']);
      (prisma.order.findMany as jest.Mock).mockResolvedValueOnce([late, early]).mockResolvedValue([]);
      const day9 = await svc.getTransactions(
        req({ from: '2026-09-09', to: '2026-09-09' }),
      );
      expect(day9.data.map((r: any) => r.orderId)).toEqual(['early']);
    });
  });

  describe('inclusion matrix', () => {
    function matrixOrders() {
      return [
        orderRow({ id: 'paid', displayId: 'POS-260910-0001' }),
        orderRow({ id: 'partial-pay', displayId: 'POS-260910-0002', paymentStatus: 'PARTIAL_PAID' }),
        orderRow({ id: 'pending-pay', displayId: 'POS-260910-0003', paymentStatus: 'PENDING' }),
        orderRow({
          id: 'full-refund', displayId: 'POS-260910-0004',
          refunds: [{ amount: 1000, status: 'completed', processedAt: D('2026-09-11T10:00:00+06:00') }],
        }),
        orderRow({
          id: 'partial-refund', displayId: 'POS-260910-0005', total: 1000,
          refunds: [{ amount: 300, status: 'completed', processedAt: D('2026-09-11T10:00:00+06:00') }],
        }),
        orderRow({
          id: 'pending-refund', displayId: 'POS-260910-0006',
          refunds: [{ amount: 1000, status: 'pending', processedAt: null }],
        }),
        orderRow({ id: 'cancelled', displayId: 'POS-260910-0007', status: { name: 'Cancelled' } }),
        orderRow({ id: 'returned', displayId: 'POS-260910-0008', status: { name: 'Returned' } }),
        orderRow({ id: 'damaged', displayId: 'POS-260910-0009', status: { name: 'Damaged' } }),
        orderRow({ id: 'trashed', displayId: 'POS-260910-0010', trashedAt: D('2026-09-12T10:00:00+06:00') }),
        orderRow({ id: 'ecom', displayId: 'POS-260910-0011', source: 'ECOMMERCE' }),
      ];
    }

    it('counts only valid net sales in KPIs; flags full refunds in rows', async () => {
      mockOrders(matrixOrders());
      const res = await svc.getOverview(req());
      // paid + partial-refund(net 700) + pending-refund(1000, ignored) = 2700 net, 3 orders
      expect(res.data.netSales).toBe(2700);
      expect(res.data.grossSales).toBe(3000);
      expect(res.data.refundsTotal).toBe(300);
      expect(res.data.totalOrders).toBe(3);
      expect(res.data.unitsSold).toBe(6);
      expect(res.data.avgOrderValue).toBe(900);

      (prisma.order.findMany as jest.Mock).mockResolvedValueOnce(matrixOrders()).mockResolvedValue([]);
      const tx = await svc.getTransactions(req({ pageSize: 100 }));
      const flagged = tx.data.find((r: any) => r.orderId === 'full-refund');
      expect(flagged).toBeDefined();
      expect(flagged!.status).toBe('Refunded');
      expect(flagged!.total).toBe(0);
      expect(tx.data.find((r: any) => r.orderId === 'cancelled')).toBeUndefined();
    });
  });

  describe('transactions paging', () => {
    it('caps pageSize at 100 and sorts stably by reportingAt then displayId', async () => {
      const rows = [3, 1, 2].map((n) =>
        orderRow({ id: `o${n}`, displayId: `POS-260910-000${n}` }),
      );
      mockOrders(rows);
      const res = await svc.getTransactions(req({ page: 1, pageSize: 500 }));
      expect(res.meta.pageSize).toBe(100);
      expect(res.data.map((r: any) => r.orderId)).toEqual(['o1', 'o2', 'o3']);
      expect(res.meta.total).toBe(3);
      expect(res.meta.totalPages).toBe(1);
    });
  });

  describe('overview == export totals', () => {
    it('export row aggregates match overview KPIs', async () => {
      const rows = [
        orderRow({ id: 'a', displayId: 'POS-260910-0001', total: 1000 }),
        orderRow({
          id: 'b', displayId: 'POS-260910-0002', total: 2000, discount: 200,
          items: [{ quantity: 1, price: 2000, product: { name: 'Fan' }, variant: null, combo: null }],
          payments: [payment({ amount: 2000 })],
          refunds: [{ amount: 500, status: 'approved', processedAt: D('2026-09-11T10:00:00+06:00') }],
        }),
        orderRow({
          id: 'c', displayId: 'POS-260910-0003',
          refunds: [{ amount: 1000, status: 'completed', processedAt: D('2026-09-11T10:00:00+06:00') }],
        }),
      ];
      mockOrders(rows);
      const over = await svc.getOverview(req());
      (prisma.order.findMany as jest.Mock).mockResolvedValueOnce(rows).mockResolvedValue([]);
      const { rows: exportRows } = await svc.collectExportRows(req());
      const counted = exportRows.filter((r) => !r.fullyRefunded);
      const net = counted.reduce((s, r) => s + r.netTotal, 0);
      const gross = counted.reduce((s, r) => s + r.grossTotal, 0);
      expect(net).toBe(over.data.netSales);
      expect(gross).toBe(over.data.grossSales);
      expect(counted.length).toBe(over.data.totalOrders);
      expect(exportRows.find((r) => r.orderId === 'c')?.fullyRefunded).toBe(true);
    });

    it('workbook totals row matches dashboard net sales', async () => {
      const rows = [orderRow({ id: 'a', displayId: 'POS-260910-0001', total: 1000 })];
      mockOrders(rows);
      const over = await svc.getOverview(req());
      (prisma.order.findMany as jest.Mock).mockResolvedValueOnce(rows).mockResolvedValue([]);
      const { buffer } = await svc.buildExport(req());
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];
      let found: number | null = null;
      ws.eachRow((row: any) => {
        if (String(row.getCell(1).value).includes('TOTAL')) found = Number(row.getCell(10).value);
      });
      expect(found).toBe(over.data.netSales);
    });
  });

  describe('display fallbacks', () => {
    it('uses Walk-in and Unknown fallbacks without dropping totals', async () => {
      mockOrders([
        orderRow({ id: 'w', posSession: { cashierId: 'cash-Z', cashier: null } }),
      ]);
      const res = await svc.getTransactions(req());
      expect(res.data[0].customerName).toBe('Walk-in');
      expect(res.data[0].staffName).toBe('Unknown');
      (prisma.order.findMany as jest.Mock).mockResolvedValueOnce([
        orderRow({ id: 'w', posSession: { cashierId: 'cash-Z', cashier: null } }),
      ]).mockResolvedValue([]);
      const over = await svc.getOverview(req());
      expect(over.data.netSales).toBe(1000);
    });
  });
});
