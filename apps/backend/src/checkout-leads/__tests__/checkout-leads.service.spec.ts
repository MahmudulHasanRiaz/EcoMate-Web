import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CheckoutLeadsService } from '../checkout-leads.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomersService } from '../../customers/customers.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';

const configSnapshotMock = {
  enabledProviders: ['meta'],
  normalizerVersion: 1,
  capturedAt: '2025-01-15T00:00:00.000Z',
};

describe('CheckoutLeadsService', () => {
  let service: CheckoutLeadsService;
  let prisma: PrismaService;
  let capture: jest.Mock;
  let module: TestingModule;

  const initialStatus = {
    id: 'status-initial',
    name: 'Pending',
    isInitial: true,
  };

  const mockLead = {
    id: 'lead-1',
    displayId: 'LEAD-250115-0001',
    phone: '+8801812345678',
    name: 'Jane Doe',
    email: 'jane@example.com',
    status: 'PENDING',
    fingerprint: null,
    items: [
      { productId: 'prod-1', name: 'Prod 1', price: 500, quantity: 2 },
    ],
    payload: null,
    paymentMethod: null,
    ctxId: 'ctx-lead',
    convertedOrderId: null,
    convertedById: null,
    convertedAt: null,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        CheckoutLeadsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            checkoutLead: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              count: jest.fn(),
            },
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
            orderStatus: {
              findFirst: jest.fn(),
            },
            order: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            payment: {
              create: jest.fn(),
            },
            userProfile: {
              findUnique: jest.fn(),
            },
            trackingSnapshot: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        },
        {
          provide: CustomersService,
          useValue: {
            findOrCreateCustomer: jest
              .fn()
              .mockResolvedValue({ id: 'customer-1' }),
          },
        },
        {
          provide: TrackingCaptureService,
          useValue: {
            capture: jest.fn().mockResolvedValue({
              status: 'CAPTURED',
              snapshotId: 'snap-1',
            }),
          },
        },
        {
          provide: TrackingSettingsService,
          useValue: {
            buildConfigSnapshot: jest
              .fn()
              .mockResolvedValue(configSnapshotMock),
          },
        },
      ],
    }).compile();

    service = module.get<CheckoutLeadsService>(CheckoutLeadsService);
    prisma = module.get<PrismaService>(PrismaService);
    capture = module.get<TrackingCaptureService>(
      TrackingCaptureService,
    ).capture as jest.Mock;

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) =>
      cb(prisma),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upsert', () => {
    it('creates a lead and captures a Lead snapshot (no legacy track)', async () => {
      (prisma.checkoutLead.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.checkoutLead.create as jest.Mock).mockResolvedValue(mockLead);

      const result = await service.upsert({
        phone: '01812345678',
        name: 'Jane Doe',
        items: [{ productId: 'prod-1', price: 500, quantity: 2 }],
        ctxId: 'ctx-abc',
      });

      expect(result).toEqual(mockLead);
      expect(prisma.checkoutLead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '+8801812345678',
            ctxId: 'ctx-abc',
          }),
        }),
      );

      // fireLeadEvent is fire-and-forget; flush the async chain
      await new Promise((r) => setTimeout(r, 0));

      expect(capture).toHaveBeenCalledTimes(1);
      const [input] = capture.mock.calls[0];
      expect(input.eventId).toBe('lead_lead-1');
      expect(input.eventType).toBe('Lead');
      expect(input.ctxId).toBe('ctx-abc');
      expect(input.actionSource).toBe('website');
      expect(input.payload).toEqual(
        expect.objectContaining({
          currency: 'BDT',
          customer: { phone: '+8801812345678', firstName: 'Jane Doe' },
        }),
      );
      // A Lead carries no monetary value (design §10) so it can never be
      // misread as a purchase — only a converted lead produces an offline Purchase.
      expect((input.payload as any).value).toBeUndefined();
      expect(input.configSnapshot).toEqual(configSnapshotMock);
    });

    it('skips the Lead capture when a recent lead snapshot exists (cooldown)', async () => {
      (prisma.checkoutLead.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.checkoutLead.create as jest.Mock).mockResolvedValue(mockLead);
      (prisma.trackingSnapshot.findFirst as jest.Mock).mockResolvedValue({
        id: 'snap-1',
      });

      await service.upsert({ phone: '01812345678', name: 'Jane Doe' });
      await new Promise((r) => setTimeout(r, 0));

      expect(capture).not.toHaveBeenCalled();
    });

    it('checks the cooldown via a TrackingSnapshot payload-path lookup for the phone', async () => {
      (prisma.checkoutLead.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.checkoutLead.create as jest.Mock).mockResolvedValue(mockLead);

      await service.upsert({ phone: '01812345678', name: 'Jane Doe' });
      await new Promise((r) => setTimeout(r, 0));

      expect(prisma.trackingSnapshot.findFirst).toHaveBeenCalledWith({
        where: {
          eventType: 'Lead',
          payload: { path: ['customer', 'phone'], equals: '+8801812345678' },
          createdAt: { gte: expect.any(Date) },
        },
      });
      // No legacy TrackingEvent reads or writes on the lead path.
      expect((prisma as any).trackingEvent).toBeUndefined();
    });

    it('rejects an invalid Bangladeshi phone', async () => {
      await expect(service.upsert({ phone: '123' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('convertToOrder', () => {
    it('converts a lead and captures an offline Purchase inside the transaction', async () => {
      (prisma.checkoutLead.findUnique as jest.Mock).mockResolvedValue(mockLead);
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        initialStatus,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Admin',
        lastName: 'User',
      });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        id: 'order-1',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({});
      (prisma.checkoutLead.update as jest.Mock).mockResolvedValue({});
      (prisma.checkoutLead.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      const fullOrder = {
        id: 'order-1',
        total: 1000,
        createdAt: new Date('2025-01-15'),
        salesChannel: 'CALL',
        trackingSessionId: 'ctx-lead',
        guestPhone: '+8801812345678',
        customer: { name: 'Jane Doe', phone: '+8801812345678' },
        items: [
          { productId: 'prod-1', quantity: 2, price: 500 },
        ],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(fullOrder);

      await service.convertToOrder('lead-1', 'admin-1');

      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trackingSessionId: 'ctx-lead',
          }),
        }),
      );

      expect(capture).toHaveBeenCalledTimes(1);
      const [input, txArg] = capture.mock.calls[0];
      expect(input.eventId).toBe('purchase_order-1');
      expect(input.eventType).toBe('Purchase');
      expect(input.orderId).toBe('order-1');
      expect(input.ctxId).toBe('ctx-lead');
      expect(input.actionSource).toBe('physical_store');
      expect(input.payload).toEqual(
        expect.objectContaining({
          value: 1000,
          currency: 'BDT',
          content_ids: ['prod-1'],
          num_items: 2,
          orderId: 'order-1',
        }),
      );
      // capture runs inside the business transaction client
      expect(txArg).toBeDefined();
    });

    it('degrades when the lead has no ctxId (order trackingSessionId and capture ctxId undefined)', async () => {
      const leadWithoutCtx = { ...mockLead, ctxId: null };
      (prisma.checkoutLead.findUnique as jest.Mock).mockResolvedValue(
        leadWithoutCtx,
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        initialStatus,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Admin',
        lastName: 'User',
      });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        id: 'order-2',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({});
      (prisma.checkoutLead.update as jest.Mock).mockResolvedValue({});
      (prisma.checkoutLead.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      const fullOrder = {
        id: 'order-2',
        total: 500,
        createdAt: new Date('2025-01-15'),
        salesChannel: 'CALL',
        trackingSessionId: null,
        guestPhone: '+8801812345678',
        customer: { name: 'Jane Doe', phone: '+8801812345678' },
        items: [{ productId: 'prod-1', quantity: 1, price: 500 }],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(fullOrder);

      await service.convertToOrder('lead-2', 'admin-1');

      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ trackingSessionId: undefined }),
        }),
      );
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].ctxId).toBeUndefined();
    });
  });
});
