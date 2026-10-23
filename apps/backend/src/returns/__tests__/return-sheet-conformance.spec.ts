import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from '../../courier-manager/courier-webhook.service';
import { CourierManagerService } from '../../courier-manager/courier-manager.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import {
  mapCourierReturnSignal,
  mapCourierStatusToDispatchStatus,
} from '../../courier-manager/courier-status-mapper';
import { ReturnsService } from '../returns.service';

/**
 * RETURN SHEET CONFORMANCE (2026-10-23)
 * Authority: "EcoMate — Courier Status Mapping (Latest Docs)" —
 * Rules 2, 16, 19, 20, 25, 26, 27 + Return Creation tab rows 1–29.
 *
 * Pins the six audited points:
 *  (a) PARTIAL returns are NEVER auto-created from a courier signal.
 *  (b) FULL returns auto-create exactly ONE Return on any return-indicating
 *      event, from ANY courier, including conditional-cancel returns.
 *  (c) Courier 'received' → Return stage DELIVERED, never RECEIVED; stock is
 *      staff-receive-only.
 *  (d) Courier events cap dispatch at RETURN_PENDING — never RETURNED
 *      (webhook + sync maps).
 *  (e) Exchange displayId is `Ex-XXXX` and scans resolve.
 *  (f) FULL exchange creates ONE linked Return at creation (pinned in
 *      exchange-f8-flow.spec.ts).
 */
describe('Return sheet conformance — auto-create policy (Rules 19, 27)', () => {
  it('(a) Steadfast partial-return labels are PARTIAL + link-only (never create)', () => {
    for (const label of [
      'partial_delivered_return_proccessing',
      'partial_delivered_return_processing',
      'partial_delivered_return_rider_assigned',
      'partial_delivered_return_received',
    ]) {
      expect(mapCourierReturnSignal('steadfast', label)).toEqual(
        expect.objectContaining({
          type: 'PARTIAL',
          createIfMissing: false,
        }),
      );
    }
    // Only the *_received label claims the parcel is back — and even then the
    // Return stage is DELIVERED, never RECEIVED.
    expect(mapCourierReturnSignal('steadfast', 'partial_delivered_return_received')).toEqual(
      expect.objectContaining({ stage: 'DELIVERED', type: 'PARTIAL' }),
    );
    expect(
      mapCourierReturnSignal('steadfast', 'partial_delivered_return_rider_assigned'),
    ).toEqual(expect.objectContaining({ stage: 'IN_PROGRESS' }));
  });

  it('(b) every courier return-indicating label maps to a FULL auto-create signal', () => {
    const inProgress: Array<[string, string]> = [
      ['pathao', 'order.return-id-created'],
      ['pathao', 'order.return-in-transit'],
      ['pathao', 'order.returned'],
      ['pathao', 'order.paid-return'],
      ['carrybee', 'order.returned'],
      ['carrybee', 'order.paid-return'],
      ['carrybee', 'order.returned-at-sorting'],
      ['carrybee', 'order.returned-in-transit'],
      ['redx', 'agent-returning'],
      ['steadfast', 'cancelled_return_proccessing'],
      ['steadfast', 'cancelled_return_rider_assigned'],
    ];
    for (const [courier, label] of inProgress) {
      expect(mapCourierReturnSignal(courier, label)).toEqual(
        expect.objectContaining({
          stage: 'IN_PROGRESS',
          type: 'FULL',
          createIfMissing: true,
        }),
      );
    }

    // Back-with-merchant: create directly at stage DELIVERED (Rule 27a).
    // RedX `returned` is its terminal return state — the parcel back with
    // the merchant (owner decision 2026-10-23: RedX behaves like the rest).
    for (const [courier, label] of [
      ['pathao', 'order.returned-to-merchant'],
      ['carrybee', 'order.returned-to-merchant'],
      ['steadfast', 'cancelled_return_received'],
      ['redx', 'returned'],
    ] as Array<[string, string]>) {
      expect(mapCourierReturnSignal(courier, label)).toEqual(
        expect.objectContaining({
          stage: 'DELIVERED',
          type: 'FULL',
          createIfMissing: true,
        }),
      );
    }
  });

  it('(b) Steadfast return_request / return_list_accepted are LINK-only (owner decision 2026-10-23)', () => {
    for (const label of ['return_request', 'return_list_accepted']) {
      expect(mapCourierReturnSignal('steadfast', label)).toEqual(
        expect.objectContaining({ createIfMissing: false, type: 'FULL' }),
      );
    }
  });

  it('(d) no courier return label ever maps to RETURNED', () => {
    const labels: Array<[string, string]> = [
      ['pathao', 'order.returned-to-merchant'],
      ['pathao', 'order.returned'],
      ['pathao', 'order.paid-return'],
      ['carrybee', 'order.returned-to-merchant'],
      ['carrybee', 'order.returned'],
      ['redx', 'returned'],
      ['steadfast', 'returned'],
      ['steadfast', 'cancelled_return_received'],
      ['steadfast', 'cancelled_return_proccessing'],
      ['steadfast', 'partial_delivered_return_received'],
      ['pathao', 'returned-to-merchant'],
      ['carrybee', 'some returned label'],
    ];
    for (const [courier, label] of labels) {
      expect(mapCourierStatusToDispatchStatus(courier, label)).not.toBe('RETURNED');
    }
  });
});

describe('Return sheet conformance — courier webhook wiring', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;
  let manager: any;
  let cancelReturnStock: any;
  let returns: any;

  const order = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    timeline: [],
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'ORD-1',
    courierService: 'steadfast',
  };

  const returnPendingStatus = { id: 'status-rp', name: 'Return Pending' };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.name === 'Return Pending') return Promise.resolve(returnPendingStatus);
          return Promise.resolve(null);
        }),
      },
      dispatch: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((cb: any) => cb({})),
    };
    ordersService = { updateStatus: jest.fn().mockResolvedValue({}) };
    manager = { getSteadfastReturnStatus: jest.fn() };
    cancelReturnStock = {
      restoreForOrder: jest.fn().mockResolvedValue(undefined),
      restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
    };
    returns = {
      upsertCourierReturn: jest.fn().mockResolvedValue({
        id: 'ret-1',
        displayId: 'RTN-261023-0001',
        status: 'REQUESTED',
      }),
      setReturnTransit: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'IN_TRANSIT' }),
      recordCourierParcelBack: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'DELIVERED' }),
      restockReturn: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'RESTOCKED' }),
      orderItemsSnapshot: jest.fn().mockResolvedValue([{ productId: 'p-1', quantity: 1 }]),
      findOpenStaffReturnWithItems: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: manager },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
        { provide: ReturnsService, useValue: returns },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  it('(b) Pathao order.returned links/creates the Return (in-progress)', async () => {
    await service.handlePathao({ event: 'order.returned', consignment_id: 'CG-1' });
    expect(returns.upsertCourierReturn).toHaveBeenCalledTimes(1);
    expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        courier: 'pathao',
        courierStatus: 'order.returned',
        type: 'FULL',
      }),
    );
    expect(returns.setReturnTransit).toHaveBeenCalledWith('ret-1', 'order.returned');
    expect(returns.recordCourierParcelBack).not.toHaveBeenCalled();
  });

  it('(a)(b) Pathao order.return-id-created with return_type=partial-delivery stays PARTIAL', async () => {
    await service.handlePathao({
      event: 'order.return-id-created',
      consignment_id: 'CG-1',
      return_consignment_id: 'RL-1',
      return_type: 'partial-delivery',
    });
    expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PARTIAL', courierReturnId: 'RL-1' }),
    );
  });

  it('(a) PARTIAL with no active Return: no stage write, hold alert only', async () => {
    returns.upsertCourierReturn.mockResolvedValue(null);
    const warn = jest.spyOn((service as any).logger, 'warn');
    await service.handlePathao({
      event: 'order.return-id-created',
      consignment_id: 'CG-1',
      return_type: 'partial-delivery',
    });
    expect(returns.setReturnTransit).not.toHaveBeenCalled();
    expect(returns.recordCourierParcelBack).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/HOLD \+ staff alert/));
  });

  it('(b) Carrybee order.returned links/creates the Return (in-progress)', async () => {
    await service.handleCarrybee({ event: 'order.returned', consignment_id: 'CG-1' });
    expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        courier: 'carrybee',
        courierStatus: 'order.returned',
        type: 'FULL',
      }),
    );
    expect(returns.setReturnTransit).toHaveBeenCalledWith('ret-1', 'order.returned');
  });

  it('(b) RedX returned links/creates the Return and marks it DELIVERED (owner 2026-10-23)', async () => {
    await service.handleRedx({ status: 'returned', tracking_number: 'RX-1', invoice_number: 'ORD-1' });
    expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
      expect.objectContaining({ courier: 'redx', courierStatus: 'returned', type: 'FULL' }),
    );
    expect(returns.recordCourierParcelBack).toHaveBeenCalledWith('ret-1', 'returned');
    expect(returns.setReturnTransit).not.toHaveBeenCalled();
  });

  it('(b)(d) Pathao back-with-merchant: dispatch capped at RETURN_PENDING, Return stage DELIVERED', async () => {
    await service.handlePathao({
      event: 'order.returned-to-merchant',
      consignment_id: 'CG-1',
    });
    expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'RETURN_PENDING' }),
      }),
    );
    expect(returns.recordCourierParcelBack).toHaveBeenCalledWith(
      'ret-1',
      'order.returned-to-merchant',
    );
    expect(returns.setReturnTransit).not.toHaveBeenCalled();
    expect(returns.restockReturn).not.toHaveBeenCalled();
  });

  it('(b) Steadfast conditional cancel (picked up) creates a FULL return in progress', async () => {
    prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'PICKED_UP' });
    await service.handleSteadfast({
      notification_type: 'delivery_status',
      consignment_id: 'CG-1',
      status: 'cancelled',
    });
    expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'RETURN_PENDING' }),
      }),
    );
    expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        courier: 'steadfast',
        courierStatus: 'cancelled',
        type: 'FULL',
      }),
    );
    expect(returns.setReturnTransit).toHaveBeenCalledWith('ret-1', 'cancelled');
  });

  it('(b) Steadfast conditional cancel without pickup: CANCELLED, NO Return', async () => {
    prisma.dispatch.findFirst.mockResolvedValue(null);
    await service.handleSteadfast({
      notification_type: 'delivery_status',
      consignment_id: 'CG-1',
      status: 'cancelled',
    });
    expect(returns.upsertCourierReturn).not.toHaveBeenCalled();
  });

  it('(c)(d) Steadfast cancelled_return_received: RETURN_PENDING + stage DELIVERED, no restock', async () => {
    manager.getSteadfastReturnStatus.mockResolvedValue({
      deliveryStatus: 'cancelled_return_received',
    });
    const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });
    expect(result).toEqual(
      expect.objectContaining({
        dispatchStatus: 'RETURN_PENDING',
        returnStatus: 'DELIVERED',
        stockReconciled: false,
      }),
    );
    expect(returns.recordCourierParcelBack).toHaveBeenCalledWith(
      'ret-1',
      'cancelled_return_received',
    );
    expect(returns.restockReturn).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('(b) Steadfast return_request is LINK-only (never creates a Return)', async () => {
    await service.handleSteadfast({
      notification_type: 'return_request',
      consignment_id: 'CG-1',
      return_request_id: 'RQ-1',
    });
    expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
      expect.objectContaining({ createIfMissing: false, courierReturnId: 'RQ-1' }),
    );
  });
});
