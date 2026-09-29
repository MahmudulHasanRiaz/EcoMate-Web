import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CacheService } from '../../cache/cache.service';
import { ManagedStockLedgerService } from '../managed-stock-ledger.service';

describe('InventoryService — grouped transfer history (listTransfers)', () => {
  let service: InventoryService;
  let prisma: PrismaService;

  const variant = {
    sku: 'SH-1-S',
    attributeValues: [
      { attributeValue: { value: 'S', attribute: { name: 'Size' } } },
    ],
  };

  const requestRow = {
    id: 'req-aaaa1111',
    idempotencyKey: 'POS_TRF_cashier-1_1759160000_1_ab12cd',
    status: 'FULFILLED',
    notes: 'Transfer requested from POS — 2x Shirt',
    sourceWarehouseId: 'main',
    destWarehouseId: 'showroom-1',
    requestedBy: 'cashier-1',
    performedBy: 'cashier-1',
    createdAt: new Date('2026-09-29T10:00:00Z'),
    completedAt: new Date('2026-09-29T10:05:00Z'),
    sourceWarehouse: { id: 'main', name: 'Main Warehouse', type: 'main' },
    destWarehouse: { id: 'showroom-1', name: 'Gulshan', type: 'showroom' },
    items: [
      {
        id: 'it-1',
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        product: { id: 'prod-1', name: 'Shirt', sku: 'SH-1' },
        variant,
      },
    ],
  };

  const manualRow = {
    id: 'man-bbbb2222',
    idempotencyKey: '3f0c6d5e-8a41-4a0d-9d0e-1a2b3c4d5e6f',
    status: 'IN_PROGRESS',
    notes: 'Top-up',
    sourceWarehouseId: 'main',
    destWarehouseId: 'showroom-1',
    requestedBy: null,
    performedBy: 'admin@x.com',
    createdAt: new Date('2026-09-29T11:00:00Z'),
    completedAt: null,
    sourceWarehouse: { id: 'main', name: 'Main Warehouse', type: 'main' },
    destWarehouse: { id: 'showroom-1', name: 'Gulshan', type: 'showroom' },
    items: [],
  };

  const outLeg = (transferId: string, qty: number, before: number) => ({
    id: `leg-out-${transferId}-${qty}`,
    productId: 'prod-1',
    variantId: 'var-1',
    quantity: qty,
    direction: 'OUT' as const,
    stockBefore: before,
    stockAfter: before - qty,
    type: 'TRANSFER_OUT',
    reason: `Transfer ${transferId} to Gulshan`,
    performedBy: 'admin@x.com',
    createdAt: new Date('2026-09-29T10:01:00Z'),
    warehouse: { id: 'main', name: 'Main Warehouse' },
    product: { id: 'prod-1', name: 'Shirt', sku: 'SH-1' },
    variant,
  });

  const inLeg = (transferId: string, qty: number) => ({
    id: `leg-in-${transferId}`,
    productId: 'prod-1',
    variantId: 'var-1',
    quantity: qty,
    direction: 'IN' as const,
    stockBefore: 0,
    stockAfter: qty,
    type: 'TRANSFER_IN',
    reason: `Transfer ${transferId} from Main Warehouse`,
    performedBy: 'admin@x.com',
    createdAt: new Date('2026-09-29T10:04:00Z'),
    warehouse: { id: 'showroom-1', name: 'Gulshan' },
    product: { id: 'prod-1', name: 'Shirt', sku: 'SH-1' },
    variant,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: {
            stockTransfer: {
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            physicalInventoryLedger: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        { provide: StockService, useValue: {} },
        { provide: StockRouterService, useValue: {} },
        { provide: CostingLotService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CacheService, useValue: {} },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('rolls a POS request, its APPROVE_* children and both stock legs into ONE row', async () => {
    (prisma.stockTransfer.findMany as jest.Mock)
      .mockResolvedValueOnce([requestRow]) // page rows
      .mockResolvedValueOnce([
        { id: 'exec-1', idempotencyKey: 'APPROVE_req-aaaa1111_it-1' },
      ]); // children
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(1);
    (prisma.physicalInventoryLedger.findMany as jest.Mock).mockResolvedValue([
      outLeg('exec-1', 2, 10),
      inLeg('exec-1', 2),
    ]);

    const res = await service.listTransfers();

    expect(res.data).toHaveLength(1);
    const row = res.data[0];
    expect(row.id).toBe('req-aaaa1111');
    expect(row.kind).toBe('REQUEST');
    expect(row.status).toBe('COMPLETED');
    expect(row.source.name).toBe('Main Warehouse');
    expect(row.destination.name).toBe('Gulshan');
    expect(row.items).toEqual([
      expect.objectContaining({
        productName: 'Shirt',
        variantLabel: 'S',
        quantity: 2,
      }),
    ]);
    expect(row.movements).toHaveLength(2);
    expect(row.movements.map((m: any) => m.direction).sort()).toEqual(['IN', 'OUT']);
    expect(row.movements.map((m: any) => m.warehouse?.name).sort()).toEqual([
      'Gulshan',
      'Main Warehouse',
    ]);
    expect(res.meta).toMatchObject({ total: 1, page: 1, perPage: 20 });
  });

  it('only matches ledger legs that belong to this row (child ids)', async () => {
    (prisma.stockTransfer.findMany as jest.Mock)
      .mockResolvedValueOnce([requestRow])
      .mockResolvedValueOnce([
        { id: 'exec-1', idempotencyKey: 'APPROVE_req-aaaa1111_it-1' },
      ]);
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(1);
    (prisma.physicalInventoryLedger.findMany as jest.Mock).mockResolvedValue([]);

    await service.listTransfers();

    const ledgerArgs = (prisma.physicalInventoryLedger.findMany as jest.Mock).mock.calls[0][0];
    const idOr = ledgerArgs.where.AND[0].OR;
    expect(idOr).toEqual([
      { reason: { contains: 'req-aaaa1111' } },
      { reason: { contains: 'exec-1' } },
    ]);
    expect(ledgerArgs.where.AND[1].type).toEqual({
      in: ['transfer', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'],
    });
  });

  it('excludes APPROVE_* child headers from the row list and requests only via their status', async () => {
    (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(0);

    await service.listTransfers();

    const args = (prisma.stockTransfer.findMany as jest.Mock).mock.calls[0][0];
    const originOr = args.where.AND[0].OR;
    expect(originOr).toEqual([
      {
        idempotencyKey: { startsWith: 'POS_TRF_' },
        status: { in: ['FULFILLED', 'APPROVAL_FAILED'] },
      },
      {
        NOT: { idempotencyKey: { startsWith: 'APPROVE_' } },
        status: { in: ['IN_PROGRESS', 'COMPLETED'] },
      },
    ]);
  });

  it('derives items from OUT legs for manual transfers with no transfer-item rows', async () => {
    (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValueOnce([manualRow]);
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(1);
    (prisma.physicalInventoryLedger.findMany as jest.Mock).mockResolvedValue([
      outLeg('man-bbbb2222', 3, 10),
      outLeg('man-bbbb2222', 2, 7),
      inLeg('man-bbbb2222', 5),
    ]);

    const res = await service.listTransfers();

    const row = res.data[0];
    expect(row.kind).toBe('MANUAL');
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.items).toEqual([
      expect.objectContaining({ productName: 'Shirt', quantity: 5 }),
    ]);
    expect(row.movements).toHaveLength(3);
    expect(row.initiatedBy).toBe('admin@x.com');
  });

  it('maps APPROVAL_FAILED requests to a PARTIAL status', async () => {
    (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValueOnce([
      { ...requestRow, status: 'APPROVAL_FAILED' },
    ]);
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(1);

    const res = await service.listTransfers();

    expect(res.data[0].status).toBe('PARTIAL');
    expect(res.data[0].movements).toEqual([]);
  });

  it('applies the status filter server-side', async () => {
    (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(0);

    await service.listTransfers(1, 20, undefined, 'transit');

    const args = (prisma.stockTransfer.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        { status: 'IN_PROGRESS', NOT: { idempotencyKey: { startsWith: 'APPROVE_' } } },
      ]),
    );
  });

  it('searches id, notes, route names and request item product names', async () => {
    (prisma.stockTransfer.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.stockTransfer.count as jest.Mock).mockResolvedValue(0);

    await service.listTransfers(1, 20, 'shirt');

    const args = (prisma.stockTransfer.findMany as jest.Mock).mock.calls[0][0];
    const searchOr = args.where.AND[args.where.AND.length - 1].OR;
    const blob = JSON.stringify(searchOr);
    expect(blob).toContain('shirt');
    expect(blob).toContain('items');
    expect(blob).toContain('sourceWarehouse');
    expect(blob).toContain('destWarehouse');
  });
});
