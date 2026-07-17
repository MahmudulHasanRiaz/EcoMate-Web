import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PackingService } from './packing.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { TestingModule } from '@nestjs/testing';

describe('PackingService', () => {
  let service: PackingService;
  let prisma: PrismaService;
  let ordersService: OrdersService;

  const mockPrisma = {
    $transaction: jest.fn(),
    orderStatus: { findUnique: jest.fn() },
    order: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    packingLock: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    userProfile: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation(async (operations) => {
      return Promise.all(operations);
    });

    const statusMap: Record<string, { id: string; name: string }> = {
      Confirmed: { id: 'status-confirmed', name: 'Confirmed' },
      'Packing Hold': { id: 'status-hold', name: 'Packing Hold' },
      Packed: { id: 'status-packed', name: 'Packed' },
    };
    mockPrisma.orderStatus.findUnique.mockImplementation(async (args) => {
      const name = args.where.name;
      return statusMap[name] || null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackingService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: OrdersService,
          useValue: { updateStatus: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<PackingService>(PackingService);
    prisma = module.get<PrismaService>(PrismaService);
    ordersService = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getQueue', () => {
    const confirmedStatus = { id: 'status-confirmed', name: 'Confirmed' };

    it('should return empty array when no confirmed orders', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getQueue();

      expect(result).toEqual([]);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            statusId: { in: ['status-confirmed', 'status-hold'] },
          }),
        }),
      );
    });

    it('should throw NotFoundException when Confirmed status not found', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getQueue()).rejects.toThrow(NotFoundException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('should filter by search in displayId, guestName, guestPhone', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      await service.getQueue('ORD-123');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            statusId: { in: ['status-confirmed', 'status-hold'] },
            OR: [
              { displayId: { contains: 'ORD-123', mode: 'insensitive' } },
              { guestName: { contains: 'ORD-123', mode: 'insensitive' } },
              { guestPhone: { contains: 'ORD-123', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should map orders to queue items with customer info', async () => {
      const mockOrder = {
        id: 'order-1',
        displayId: 'ORD-001',
        guestName: null,
        guestPhone: null,
        createdAt: new Date('2025-01-15'),
        customer: { id: 'cust-1', name: 'John Doe', phone: '555-0100' },
        items: [
          {
            id: 'item-1',
            quantity: 2,
            variant: {
              sku: 'SKU-001',
              product: { name: 'Product A', images: ['/img.jpg'] },
              attributeValues: [
                { attributeValue: { value: 'Red' } },
                { attributeValue: { value: 'M' } },
              ],
            },
          },
        ],
        packingLock: null,
        status: { id: 'status-confirmed', name: 'Confirmed', color: 'blue' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);

      const result = await service.getQueue();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'order-1',
        displayId: 'ORD-001',
        customer: { id: 'cust-1', name: 'John Doe', phone: '555-0100' },
        items: [
          {
            id: 'item-1',
            productName: 'Product A',
            variantName: 'Red / M',
            sku: 'SKU-001',
            quantity: 2,
            image: '/img.jpg',
          },
        ],
        totalItems: 2,
        packingLock: null,
        statusName: 'Confirmed',
        statusColor: 'blue',
        createdAt: mockOrder.createdAt,
      });
    });

    it('should use guest name when no customer', async () => {
      const mockOrder = {
        id: 'order-2',
        displayId: 'ORD-002',
        guestName: 'Jane Guest',
        guestPhone: '555-0200',
        createdAt: new Date('2025-01-15'),
        customer: null,
        items: [],
        packingLock: null,
        status: { id: 'status-confirmed', name: 'Confirmed', color: 'blue' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);

      const result = await service.getQueue();

      expect(result[0].customer).toEqual({
        name: 'Jane Guest',
        phone: '555-0200',
      });
    });

    it('should set customer to null when no customer and no guest', async () => {
      const mockOrder = {
        id: 'order-3',
        displayId: 'ORD-003',
        guestName: null,
        guestPhone: null,
        createdAt: new Date('2025-01-15'),
        customer: null,
        items: [],
        packingLock: null,
        status: { id: 'status-confirmed', name: 'Confirmed', color: 'blue' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);

      const result = await service.getQueue();

      expect(result[0].customer).toBeNull();
    });

    it('should return null image when product has no images', async () => {
      const mockOrder = {
        id: 'order-4',
        displayId: 'ORD-004',
        guestName: null,
        guestPhone: null,
        createdAt: new Date('2025-01-15'),
        customer: { id: 'cust-1', name: 'John Doe', phone: '555-0100' },
        items: [
          {
            id: 'item-2',
            quantity: 1,
            variant: {
              sku: 'SKU-002',
              product: { name: 'Product B', images: null },
            },
          },
        ],
        packingLock: null,
        status: { id: 'status-confirmed', name: 'Confirmed', color: 'blue' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);

      const result = await service.getQueue();

      expect(result[0].items[0].image).toBeNull();
    });

    it('should include packing lock info when present', async () => {
      const mockOrder = {
        id: 'order-5',
        displayId: 'ORD-005',
        guestName: null,
        guestPhone: null,
        createdAt: new Date('2025-01-15'),
        customer: { id: 'cust-1', name: 'John Doe', phone: '555-0100' },
        items: [],
        packingLock: {
          packerId: 'packer-1',
          packer: { id: 'packer-1', firstName: 'Alice', lastName: 'Smith' },
          startedAt: new Date('2025-01-15T10:00:00Z'),
          expiresAt: new Date('2025-01-15T10:30:00Z'),
        },
        status: { id: 'status-confirmed', name: 'Confirmed', color: 'blue' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);

      const result = await service.getQueue();

      expect(result[0].packingLock).toEqual({
        packerId: 'packer-1',
        packerName: 'Alice Smith',
        startedAt: mockOrder.packingLock.startedAt,
        expiresAt: mockOrder.packingLock.expiresAt,
      });
    });
  });

  describe('openOrder', () => {
    const confirmedStatus = { name: 'Confirmed' };
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    it('should upsert lock for confirmed order', async () => {
      const mockOrder = {
        id: 'order-1',
        status: confirmedStatus,
        packingLock: null,
      };
      const mockLock = {
        id: 'lock-1',
        orderId: 'order-1',
        packerId: 'packer-1',
        expiresAt,
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.packingLock.upsert as jest.Mock).mockResolvedValue(mockLock);

      const result = await service.openOrder('order-1', 'packer-1');

      expect(result).toEqual(mockLock);
      expect(prisma.packingLock.upsert).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        update: {
          packerId: 'packer-1',
          startedAt: expect.any(Date),
          expiresAt: expect.any(Date),
        },
        create: {
          orderId: 'order-1',
          packerId: 'packer-1',
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException when order not found', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.openOrder('nonexistent', 'packer-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.packingLock.upsert).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when order is not confirmed or on packing hold', async () => {
      const mockOrder = {
        id: 'order-1',
        status: { name: 'Pending' },
        packingLock: null,
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

      await expect(service.openOrder('order-1', 'packer-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.packingLock.upsert).not.toHaveBeenCalled();
    });

    it('should upsert lock for packing hold order', async () => {
      const mockOrder = {
        id: 'order-1',
        status: { name: 'Packing Hold' },
        packingLock: null,
      };
      const mockLock = {
        id: 'lock-1',
        orderId: 'order-1',
        packerId: 'packer-1',
        expiresAt,
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.packingLock.upsert as jest.Mock).mockResolvedValue(mockLock);

      const result = await service.openOrder('order-1', 'packer-1');

      expect(result).toEqual(mockLock);
      expect(prisma.packingLock.upsert).toHaveBeenCalled();
    });

    it('should throw ConflictException when locked by another packer (not expired)', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockOrder = {
        id: 'order-1',
        status: confirmedStatus,
        packingLock: { packerId: 'packer-2', expiresAt: futureDate },
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

      await expect(service.openOrder('order-1', 'packer-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.packingLock.upsert).not.toHaveBeenCalled();
    });

    it('should allow opening when lock expired', async () => {
      const pastDate = new Date(Date.now() - 10 * 60 * 1000);
      const mockOrder = {
        id: 'order-1',
        status: confirmedStatus,
        packingLock: { packerId: 'packer-2', expiresAt: pastDate },
      };
      const mockLock = {
        id: 'lock-1',
        orderId: 'order-1',
        packerId: 'packer-1',
        expiresAt,
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.packingLock.upsert as jest.Mock).mockResolvedValue(mockLock);

      const result = await service.openOrder('order-1', 'packer-1');

      expect(result).toEqual(mockLock);
      expect(prisma.packingLock.upsert).toHaveBeenCalled();
    });

    it('should allow opening when same packer re-opens', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const mockOrder = {
        id: 'order-1',
        status: confirmedStatus,
        packingLock: { packerId: 'packer-1', expiresAt: futureDate },
      };
      const mockLock = {
        id: 'lock-1',
        orderId: 'order-1',
        packerId: 'packer-1',
        expiresAt,
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.packingLock.upsert as jest.Mock).mockResolvedValue(mockLock);

      const result = await service.openOrder('order-1', 'packer-1');

      expect(result).toEqual(mockLock);
      expect(prisma.packingLock.upsert).toHaveBeenCalled();
    });

    it('should handle lock with null expiresAt', async () => {
      const mockOrder = {
        id: 'order-1',
        status: confirmedStatus,
        packingLock: { packerId: 'packer-2', expiresAt: null },
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

      await expect(service.openOrder('order-1', 'packer-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('markDone', () => {
    const packedStatus = { id: 'status-packed', name: 'Packed' };

    it('should update order to Packed and delete lock', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock)
        .mockResolvedValueOnce(packedStatus)
        .mockResolvedValueOnce({ id: 'status-confirmed', name: 'Confirmed' })
        .mockResolvedValueOnce({ id: 'status-hold', name: 'Packing Hold' });
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Mahmudul',
        lastName: 'Riaz',
      });
      (prisma.order.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'order-1', timeline: [] })
        .mockResolvedValueOnce({ statusId: 'status-confirmed' });
      (prisma.packingLock.delete as jest.Mock).mockResolvedValue({});

      const result = await service.markDone(
        'order-1',
        'packer-1',
        'strict_scan',
      );

      expect(result).toEqual({ success: true, orderId: 'order-1' });
      expect(ordersService.updateStatus).toHaveBeenCalled();
      expect(prisma.packingLock.delete).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
      });
    });

    it('should throw BadRequestException when no lock exists', async () => {
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markDone('order-1', 'packer-1', 'strict_scan'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.packingLock.delete).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when locked by different packer', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-2' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);

      await expect(
        service.markDone('order-1', 'packer-1', 'strict_scan'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.packingLock.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when Packed status not found', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(null));

      await expect(
        service.markDone('order-1', 'packer-1', 'strict_scan'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.packingLock.delete).not.toHaveBeenCalled();
    });

    it('should set assignedToId on done', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock)
        .mockResolvedValueOnce(packedStatus)
        .mockResolvedValueOnce({ id: 'status-confirmed', name: 'Confirmed' })
        .mockResolvedValueOnce({ id: 'status-hold', name: 'Packing Hold' });
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Mahmudul',
        lastName: 'Riaz',
      });
      (prisma.order.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'order-1', timeline: [] })
        .mockResolvedValueOnce({ statusId: 'status-confirmed' });
      (prisma.packingLock.delete as jest.Mock).mockResolvedValue({});

      await service.markDone('order-1', 'packer-1', 'strict_scan');

      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: packedStatus.id },
        'packer-1',
        expect.any(String),
      );
    });
  });

  describe('markHold', () => {
    const holdStatus = { id: 'status-hold', name: 'Packing Hold' };

    it('should update order to Packing Hold, delete lock', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        holdStatus,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Mahmudul',
        lastName: 'Riaz',
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: 'order-1',
        timeline: [],
      });
      (prisma.packingLock.delete as jest.Mock).mockResolvedValue({});

      const result = await service.markHold(
        'order-1',
        'packer-1',
        'Missing item',
      );

      expect(result).toEqual({
        success: true,
        orderId: 'order-1',
        reason: 'Missing item',
        notes: undefined,
      });
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.packingLock.delete).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
      });
    });

    it('should throw BadRequestException when no lock exists', async () => {
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markHold('order-1', 'packer-1', 'Missing item'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when locked by different packer', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-2' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);

      await expect(
        service.markHold('order-1', 'packer-1', 'Missing item'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when Packing Hold status not found', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markHold('order-1', 'packer-1', 'Missing item'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should return reason and notes', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        holdStatus,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Mahmudul',
        lastName: 'Riaz',
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: 'order-1',
        timeline: [],
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.packingLock.delete as jest.Mock).mockResolvedValue({});

      const result = await service.markHold(
        'order-1',
        'packer-1',
        'Damaged item',
        'Needs replacement',
      );

      expect(result.reason).toBe('Damaged item');
      expect(result.notes).toBe('Needs replacement');
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ officeNotes: 'Needs replacement' }),
        }),
      );
    });

    it('should set officeNotes when notes provided', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        holdStatus,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        firstName: 'Mahmudul',
        lastName: 'Riaz',
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: 'order-1',
        timeline: [],
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.packingLock.delete as jest.Mock).mockResolvedValue({});

      await service.markHold('order-1', 'packer-1', 'Missing item', 'Some notes');

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ officeNotes: 'Some notes' }),
        }),
      );
    });
  });

  describe('releaseLock', () => {
    it('should delete lock if packer holds the lock', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-1' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);
      (prisma.packingLock.delete as jest.Mock).mockResolvedValue(mockLock);

      const result = await service.releaseLock('order-1', 'packer-1');

      expect(result).toEqual({ success: true });
      expect(prisma.packingLock.delete).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
      });
    });

    it('should return success immediately if no lock exists', async () => {
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.releaseLock('order-1', 'packer-1');

      expect(result).toEqual({ success: true });
      expect(prisma.packingLock.delete).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if lock is held by different packer', async () => {
      const mockLock = { orderId: 'order-1', packerId: 'packer-2' };
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(mockLock);

      await expect(service.releaseLock('order-1', 'packer-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.packingLock.delete).not.toHaveBeenCalled();
    });
  });

  describe('checkOrderStatus', () => {
    it('should return exists false if order not found', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.checkOrderStatus('ORD-NOT-FOUND');

      expect(result).toEqual({ exists: false });
    });

    it('should return details if order exists', async () => {
      const mockOrder = {
        id: 'order-123',
        displayId: 'ORD-260705-0002',
        status: { name: 'Shipped' },
      };
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

      const result = await service.checkOrderStatus('ORD-260705-0002');

      expect(result).toEqual({
        exists: true,
        displayId: 'ORD-260705-0002',
        status: 'Shipped',
      });
    });
  });

  describe('getStats', () => {
    const packedStatus = { id: 'status-packed', name: 'Packed' };
    const holdStatus = { id: 'status-hold', name: 'Packing Hold' };
    const confirmedStatus = { id: 'status-confirmed', name: 'Confirmed' };

    it('should return counts for a specific packer', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        holdStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        confirmedStatus,
      );
      (prisma.order.count as jest.Mock).mockResolvedValueOnce(5);
      (prisma.order.count as jest.Mock).mockResolvedValueOnce(2);
      (prisma.order.count as jest.Mock).mockResolvedValueOnce(10);

      const result = await service.getStats('packer-1');

      expect(result).toEqual({ packed: 5, held: 2, pending: 10 });
      expect(prisma.order.count).toHaveBeenNthCalledWith(1, {
        where: {
          assignedToId: 'packer-1',
          trashedAt: null,
          statusId: packedStatus.id,
          updatedAt: { gte: expect.any(Date) },
        },
      });
      expect(prisma.order.count).toHaveBeenNthCalledWith(2, {
        where: {
          assignedToId: 'packer-1',
          trashedAt: null,
          statusId: holdStatus.id,
          updatedAt: { gte: expect.any(Date) },
        },
      });
      expect(prisma.order.count).toHaveBeenNthCalledWith(3, {
        where: { trashedAt: null, statusId: confirmedStatus.id },
      });
    });

    it('should return counts for all packers when no packerId', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        holdStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        confirmedStatus,
      );
      (prisma.order.count as jest.Mock).mockResolvedValueOnce(10);
      (prisma.order.count as jest.Mock).mockResolvedValueOnce(3);
      (prisma.order.count as jest.Mock).mockResolvedValueOnce(20);

      const result = await service.getStats();

      expect(result).toEqual({ packed: 10, held: 3, pending: 20 });
      expect(prisma.order.count).toHaveBeenNthCalledWith(1, {
        where: {
          trashedAt: null,
          statusId: packedStatus.id,
          updatedAt: { gte: expect.any(Date) },
        },
      });
    });

    it('should throw NotFoundException when Packed status missing', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getStats()).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when Hold status missing', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getStats()).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when Confirmed status missing', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        holdStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getStats()).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    const packedStatus = { id: 'status-packed', name: 'Packed' };
    const holdStatus = { id: 'status-hold', name: 'Packing Hold' };

    it('should return last 50 packed/held orders for a specific packer', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        holdStatus,
      );
      const mockOrders = [
        {
          id: 'order-1',
          displayId: 'ORD-001',
          updatedAt: new Date('2025-01-16'),
          status: { name: 'Packed', color: 'green' },
          assignee: { id: 'packer-1', firstName: 'Alice', lastName: 'Smith' },
        },
        {
          id: 'order-2',
          displayId: 'ORD-002',
          updatedAt: new Date('2025-01-15'),
          status: { name: 'Packing Hold', color: 'yellow' },
          assignee: null,
        },
      ];
      (prisma.order.findMany as jest.Mock).mockResolvedValue(mockOrders);

      const result = await service.getHistory('packer-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'order-1',
        displayId: 'ORD-001',
        statusName: 'Packed',
        statusColor: 'green',
        packerName: 'Alice Smith',
        updatedAt: mockOrders[0].updatedAt,
      });
      expect(result[1]).toEqual({
        id: 'order-2',
        displayId: 'ORD-002',
        statusName: 'Packing Hold',
        statusColor: 'yellow',
        packerName: 'N/A',
        updatedAt: mockOrders[1].updatedAt,
      });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            statusId: { in: [packedStatus.id, holdStatus.id] },
            assignedToId: 'packer-1',
          }),
          take: 50,
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    it('should return history for all packers when no packerId', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        holdStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getHistory();

      expect(result).toEqual([]);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            statusId: { in: [packedStatus.id, holdStatus.id] },
          }),
        }),
      );
    });

    it('should handle null assignee gracefully', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        packedStatus,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValueOnce(
        holdStatus,
      );
      const mockOrders = [
        {
          id: 'order-1',
          displayId: 'ORD-001',
          updatedAt: new Date('2025-01-16'),
          status: { name: 'Packed', color: 'green' },
          assignee: null,
        },
      ];
      (prisma.order.findMany as jest.Mock).mockResolvedValue(mockOrders);

      const result = await service.getHistory();

      expect(result[0].packerName).toBe('N/A');
    });
  });

  describe('getActiveLocks', () => {
    it('should return list of active locks with isExpired flags', async () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000);
      const pastDate = new Date(Date.now() - 10 * 60 * 1000);
      const mockLocks = [
        {
          id: 'lock-1',
          orderId: 'order-1',
          order: { id: 'order-1', displayId: 'ORD-001' },
          packer: { id: 'packer-1', firstName: 'Alice', lastName: 'Smith' },
          startedAt: new Date('2025-01-15T10:00:00Z'),
          expiresAt: futureDate,
        },
        {
          id: 'lock-2',
          orderId: 'order-2',
          order: { id: 'order-2', displayId: 'ORD-002' },
          packer: { id: 'packer-2', firstName: 'Bob', lastName: 'Jones' },
          startedAt: new Date('2025-01-15T09:00:00Z'),
          expiresAt: pastDate,
        },
      ];
      (prisma.packingLock.findMany as jest.Mock).mockResolvedValue(mockLocks);

      const result = await service.getActiveLocks();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'lock-1',
        orderId: 'order-1',
        displayId: 'ORD-001',
        packerName: 'Alice Smith',
        startedAt: mockLocks[0].startedAt,
        expiresAt: futureDate,
        isExpired: false,
      });
      expect(result[1]).toEqual({
        id: 'lock-2',
        orderId: 'order-2',
        displayId: 'ORD-002',
        packerName: 'Bob Jones',
        startedAt: mockLocks[1].startedAt,
        expiresAt: pastDate,
        isExpired: true,
      });
    });

    it('should return empty array when no locks', async () => {
      (prisma.packingLock.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getActiveLocks();

      expect(result).toEqual([]);
    });
  });
});
