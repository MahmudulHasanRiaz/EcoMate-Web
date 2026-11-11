import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CacheService } from '../../cache/cache.service';
import { ManagedStockLedgerService } from '../managed-stock-ledger.service';

describe('InventoryService — POS transfer requests', () => {
  let service: InventoryService;
  let prisma: PrismaService;
  let prismaMock: any;
  let transferSpy: jest.SpyInstance;

  const baseRequest = {
    id: 'req-1',
    status: 'REQUESTED',
    notes: 'POS stock request — Test Product',
    createdAt: new Date('2026-09-29T10:00:00Z'),
    completedAt: null,
    sourceWarehouseId: 'banani',
    destWarehouseId: 'showroom-1',
    requestedBy: 'cashier-1',
    sourceWarehouse: { id: 'banani', name: 'Banani', type: 'showroom' },
    destWarehouse: { id: 'showroom-1', name: 'Gulshan', type: 'showroom' },
    items: [
      {
        id: 'item-1',
        productId: 'prod-1',
        variantId: null,
        quantity: 5,
        product: { id: 'prod-1', name: 'Test Product', sku: 'TST-001' },
        variant: null,
      },
    ],
  };

  beforeEach(async () => {
    prismaMock = {
      stockTransfer: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      userProfile: { findMany: jest.fn().mockResolvedValue([]) },
      // The whole approval (claim + every item + confirmation) runs in ONE
      // transaction; the fake runs the callback against the same stub.
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StockService, useValue: {} },
        { provide: StockRouterService, useValue: {} },
        { provide: CostingLotService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CacheService, useValue: {} },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);
    transferSpy = jest
      .spyOn(service, 'transfer')
      .mockResolvedValue({
        id: 'exec-1',
        productId: 'prod-1',
        productName: 'Test Product',
        quantity: 5,
        source: 'banani',
        destination: 'showroom-1',
      } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── listTransferRequests() ───────────────────────────────────

  describe('listTransferRequests', () => {
    it('paginates request statuses, newest first, instead of a fixed take: 100', async () => {
      (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValue([baseRequest]);
      (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(1);

      const res = await service.listTransferRequests(2, 5);

      expect(prisma.stockTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              in: ['REQUESTED', 'APPROVING', 'FULFILLED', 'REJECTED', 'APPROVAL_FAILED'],
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 5,
          take: 5,
        }),
      );
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual({ total: 1, page: 2, perPage: 5, totalPages: 1 });
      expect(res.data[0].requestedByUser).toBeNull();
    });

    it('defaults to page 1 / 20 rows when the caller sends no pagination', async () => {
      (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValue([]);

      const res = await service.listTransferRequests();

      expect(prisma.stockTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(res.meta.totalPages).toBe(0);
    });

    it('resolves the requesting cashier from the user profile', async () => {
      (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValue([baseRequest]);
      (prisma.userProfile.findMany as jest.Mock).mockResolvedValue([
        { id: 'cashier-1', firstName: 'Rina', lastName: 'Akter', email: 'rina@x.com' },
      ]);

      const res = await service.listTransferRequests();

      expect(prisma.userProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['cashier-1'] } } }),
      );
      expect(res.data[0].requestedByUser).toMatchObject({ firstName: 'Rina' });
    });
  });

  // ─── approveTransferRequest() ─────────────────────────────────

  describe('approveTransferRequest', () => {
    beforeEach(() => {
      (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.stockTransfer.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.stockTransfer.update as jest.Mock).mockResolvedValue(baseRequest);
    });

    it('claims the request, runs the transfer pipeline, then marks it FULFILLED', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock)
        .mockResolvedValueOnce(baseRequest)
        .mockResolvedValueOnce({ ...baseRequest, status: 'FULFILLED' });

      const result = await service.approveTransferRequest('req-1', 'admin@x.com');

      // compare-and-swap claim
      expect(prisma.stockTransfer.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'req-1', status: 'REQUESTED' },
        data: { status: 'APPROVING' },
      });
      expect(transferSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-1',
          sourceLocation: 'banani',
          destinationLocation: 'showroom-1',
          quantity: 5,
          idempotencyKey: expect.stringContaining('req-1'),
        }),
        'admin@x.com',
        // …and inside the approval transaction, so a mid-list failure rolls
        // the whole request back.
        prismaMock,
      );
      expect(prisma.stockTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({ status: 'FULFILLED' }),
        }),
      );
      expect(result.status).toBe('FULFILLED');
    });

    it('runs EVERY item inside a single transaction', async () => {
      const twoItems = {
        ...baseRequest,
        items: [
          { ...baseRequest.items[0] },
          { ...baseRequest.items[0], id: 'item-2', quantity: 3 },
        ],
      };
      (prisma.stockTransfer.findUnique as jest.Mock)
        .mockResolvedValueOnce(twoItems)
        .mockResolvedValueOnce({ ...twoItems, status: 'FULFILLED' });

      await service.approveTransferRequest('req-1', 'admin@x.com');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(transferSpy).toHaveBeenCalledTimes(2);
      const keys = transferSpy.mock.calls.map((c: any[]) => c[0].idempotencyKey);
      expect(keys).toEqual([
        'APPROVE_req-1_item-1',
        'APPROVE_req-1_item-2',
      ]);
    });

    it('refuses to run twice when another approver already claimed it', async () => {
      (prisma.stockTransfer.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.approveTransferRequest('req-1', 'admin@x.com')).rejects.toThrow(
        ConflictException,
      );
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('refuses a request that is no longer pending', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        status: 'FULFILLED',
      });

      await expect(service.approveTransferRequest('req-1', 'admin@x.com')).rejects.toThrow(
        ConflictException,
      );
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('refuses a request with no items', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        items: [],
      });

      await expect(service.approveTransferRequest('req-1', 'admin@x.com')).rejects.toThrow(
        BadRequestException,
      );
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('404s for an unknown request', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.approveTransferRequest('nope', 'admin@x.com')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('closes a failed approval as APPROVAL_FAILED without ever marking it FULFILLED', async () => {
      transferSpy.mockRejectedValue(new Error('Insufficient stock for transfer'));

      await expect(service.approveTransferRequest('req-1', 'admin@x.com')).rejects.toThrow(
        'Insufficient stock for transfer',
      );

      // The movement transaction rolled back, so nothing moved — the request is
      // closed out explicitly so it cannot be silently re-approved.
      expect(prisma.stockTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: { in: ['REQUESTED', 'APPROVING'] } },
          data: expect.objectContaining({ status: 'APPROVAL_FAILED' }),
        }),
      );
      const fulfilled = (prisma.stockTransfer.update as jest.Mock).mock.calls.some(
        (c: any[]) => c[0]?.data?.status === 'FULFILLED',
      );
      expect(fulfilled).toBe(false);
    });
  });

  // ─── rejectTransferRequest() ──────────────────────────────────

  describe('rejectTransferRequest', () => {
    it('rejects a pending request with the supplied reason', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'req-1', status: 'REQUESTED', notes: 'original' })
        .mockResolvedValueOnce({ ...baseRequest, status: 'REJECTED' });
      (prisma.stockTransfer.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.rejectTransferRequest(
        'req-1',
        'admin@x.com',
        'Not enough stock right now',
      );

      expect(prisma.stockTransfer.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'REQUESTED' },
        data: {
          status: 'REJECTED',
          notes: expect.stringContaining('reason: Not enough stock right now'),
        },
      });
      expect(result.status).toBe('REJECTED');
    });

    it('refuses to reject an already handled request', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue({
        id: 'req-1',
        status: 'FULFILLED',
        notes: null,
      });
      (prisma.stockTransfer.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.rejectTransferRequest('req-1', 'admin@x.com')).rejects.toThrow(
        ConflictException,
      );
    });

    it('404s for an unknown request', async () => {
      (prisma.stockTransfer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.rejectTransferRequest('nope', 'admin@x.com')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
