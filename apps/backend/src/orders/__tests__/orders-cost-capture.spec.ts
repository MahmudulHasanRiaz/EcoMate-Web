/**
 * P2 cost-capture tests — orders shippingCost writes (§3.2, §3.4).
 *
 * Staff-entered fulfillment cost persists with source 'manual' by default;
 * explicit 'courier_default' is honoured; absent input leaves NULL (never 0).
 * Verification fees attach to the single PENDING payment row — never spread.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  OrdersService,
  resolveShippingCostFields,
} from '../orders.service';
import { CreateOrderDto, UpdateOrderDto } from '../dto/order.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';
import { TrackingContextService } from '../../tracking/tracking-context.service';
import { CustomersService } from '../../customers/customers.service';
import { OrdersEventService } from '../orders-event.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { BlockedEntriesService } from '../../blocked-entries/blocked-entries.service';
import { SecurityService } from '../../security/security.service';
import { CouponsService } from '../../coupons/coupons.service';
import { ManagedStockLedgerService } from '../../inventory/managed-stock-ledger.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { OrderEditLockService } from '../order-edit-lock.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { TrackingEligibilityGate } from '../../tracking/tracking-eligibility-gate';

const stub = (overrides: Record<string, jest.Mock> = {}) => ({
  ...(Object.fromEntries(
    Object.keys(overrides).map((k) => [k, overrides[k]]),
  ) as any),
});

describe('order shippingCost DTO validation', () => {
  it('accepts manual / courier_default sources and non-negative costs', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      items: [{ productId: 'p', quantity: 1, price: 100 }],
      shippingCost: 60,
      shippingCostSource: 'manual',
    });
    expect(await validate(dto)).toHaveLength(0);
    const update = plainToInstance(UpdateOrderDto, {
      shippingCost: 70,
      shippingCostSource: 'courier_default',
    });
    expect(await validate(update)).toHaveLength(0);
  });

  it('rejects unknown sources and negative costs', async () => {
    const bad = plainToInstance(CreateOrderDto, {
      items: [{ productId: 'p', quantity: 1, price: 100 }],
      shippingCost: -5,
      shippingCostSource: 'guess',
    });
    const errors = await validate(bad);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveShippingCostFields', () => {
  it('defaults a provided cost to manual (staff-entered = actual)', () => {
    expect(resolveShippingCostFields({ shippingCost: 60 })).toEqual({
      shippingCost: 60,
      shippingCostSource: 'manual',
    });
  });

  it('honours an explicit courier_default source', () => {
    expect(
      resolveShippingCostFields({
        shippingCost: 60,
        shippingCostSource: 'courier_default',
      }),
    ).toEqual({ shippingCost: 60, shippingCostSource: 'courier_default' });
  });

  it('leaves NULL when no cost is provided (never zero-fills)', () => {
    expect(resolveShippingCostFields({})).toEqual({
      shippingCost: null,
      shippingCostSource: null,
    });
  });
});

describe('OrdersService.updateOrder cost capture', () => {
  let service: OrdersService;
  const txOrderUpdate = jest.fn();
  const txMocks: any = { order: { update: txOrderUpdate } };
  const orderFindUnique = jest.fn();
  const editLockGet = jest.fn().mockResolvedValue(null);
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(txMocks)),
    order: { findUnique: orderFindUnique },
  };

  const existingOrder: any = {
    id: 'o1',
    displayId: 'ORD-1',
    trashedAt: null,
    timeline: [],
    items: [],
    shippingCharge: 80,
    discount: 0,
    discountType: 'flat',
    subtotal: 1000,
    total: 1080,
    assignedToId: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    editLockGet.mockResolvedValue(null);
    orderFindUnique.mockResolvedValue(existingOrder);
    txOrderUpdate.mockImplementation(async (args: any) => ({
      id: 'o1',
      ...args.data,
    }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TrackingCaptureService, useValue: stub() },
        { provide: TrackingSettingsService, useValue: stub() },
        { provide: TrackingContextService, useValue: stub() },
        { provide: CustomersService, useValue: stub() },
        { provide: OrdersEventService, useValue: stub() },
        { provide: StockService, useValue: stub() },
        { provide: StockRouterService, useValue: stub() },
        { provide: BlockedEntriesService, useValue: stub() },
        { provide: SecurityService, useValue: stub() },
        { provide: CouponsService, useValue: stub() },
        { provide: ManagedStockLedgerService, useValue: stub() },
        { provide: CostingLotService, useValue: stub() },
        { provide: CancelReturnStockService, useValue: stub() },
        { provide: OrderStockDeductService, useValue: stub() },
        { provide: OrderEditLockService, useValue: { getLock: editLockGet } },
        { provide: CommissionsService, useValue: stub() },
        { provide: TrackingEligibilityGate, useValue: stub() },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  it('persists shippingCost with manual source and an audit note', async () => {
    await service.updateOrder('o1', {
      shippingCost: 60,
      shippingCostSource: 'manual',
    } as any);
    expect(txOrderUpdate).toHaveBeenCalled();
    const data = txOrderUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      shippingCost: 60,
      shippingCostSource: 'manual',
    });
    expect(JSON.stringify(data.timeline)).toContain('Fulfillment cost');
  });

  it('defaults the source to manual when only a cost is given', async () => {
    await service.updateOrder('o1', { shippingCost: 45 } as any);
    const data = txOrderUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      shippingCost: 45,
      shippingCostSource: 'manual',
    });
  });

  it('leaves the cost untouched when absent', async () => {
    await service.updateOrder('o1', { officeNotes: 'hi' } as any);
    const data = txOrderUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('shippingCost');
    expect(data).not.toHaveProperty('shippingCostSource');
  });
});

describe('OrdersService.verifyPayment fee capture', () => {
  let service: OrdersService;
  const txMocks: any = {
    order: { findUnique: jest.fn(), update: jest.fn() },
    orderStatus: { findUnique: jest.fn() },
    payment: { findMany: jest.fn(), update: jest.fn() },
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(txMocks)),
    order: { findUnique: jest.fn() },
  };

  const verifyingOrder: any = {
    id: 'o1',
    trashedAt: null,
    paymentStatus: 'PAYMENT_VERIFYING',
    status: { name: 'Payment Verifying' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    txMocks.order.findUnique.mockResolvedValue(verifyingOrder);
    txMocks.orderStatus.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Confirmed',
    });
    txMocks.order.update.mockImplementation(async (args: any) => ({
      ...verifyingOrder,
      ...args.data,
    }));
    txMocks.payment.update.mockImplementation(async (args: any) => args.data);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TrackingCaptureService, useValue: stub() },
        { provide: TrackingSettingsService, useValue: stub() },
        { provide: TrackingContextService, useValue: stub() },
        { provide: CustomersService, useValue: stub() },
        { provide: OrdersEventService, useValue: stub() },
        { provide: StockService, useValue: stub() },
        { provide: StockRouterService, useValue: stub() },
        { provide: BlockedEntriesService, useValue: stub() },
        { provide: SecurityService, useValue: stub() },
        { provide: CouponsService, useValue: stub() },
        { provide: ManagedStockLedgerService, useValue: stub() },
        { provide: CostingLotService, useValue: stub() },
        { provide: CancelReturnStockService, useValue: stub() },
        { provide: OrderStockDeductService, useValue: stub() },
        {
          provide: OrderEditLockService,
          useValue: { getLock: jest.fn().mockResolvedValue(null) },
        },
        { provide: CommissionsService, useValue: stub() },
        { provide: TrackingEligibilityGate, useValue: stub() },
      ],
    }).compile();
    service = module.get(OrdersService);
    jest
      .spyOn(service as any, 'handleConfirmedSideEffects')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'firePurchaseValidated')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'fireOrderStatusLifecycleEvent')
      .mockResolvedValue(undefined);
  });

  it('writes the fee onto the single PENDING payment row (F3-safe)', async () => {
    txMocks.payment.findMany.mockResolvedValue([
      { id: 'pay1', status: 'PENDING' },
    ]);
    await service.verifyPayment('o1', true, 'ok', 25);
    expect(txMocks.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { feeAmount: 25 },
    });
  });

  it('rejects the fee when several PENDING rows exist (use per-row verify)', async () => {
    txMocks.payment.findMany.mockResolvedValue([
      { id: 'pay1', status: 'PENDING' },
      { id: 'pay2', status: 'PENDING' },
    ]);
    await expect(service.verifyPayment('o1', true, 'ok', 25)).rejects.toThrow(
      BadRequestException,
    );
    expect(txMocks.payment.update).not.toHaveBeenCalled();
  });

  it('rejects the fee when no PENDING row exists', async () => {
    txMocks.payment.findMany.mockResolvedValue([]);
    await expect(service.verifyPayment('o1', true, 'ok', 25)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('verifies cleanly without a fee', async () => {
    await service.verifyPayment('o1', true, 'ok');
    expect(txMocks.payment.update).not.toHaveBeenCalled();
    expect(txMocks.order.update).toHaveBeenCalled();
  });
});
