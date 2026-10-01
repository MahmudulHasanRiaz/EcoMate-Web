import { Test, TestingModule } from '@nestjs/testing';
import { PackingController } from './packing.controller';
import { PackingService } from './packing.service';

describe('PackingController', () => {
  let controller: PackingController;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    svc = {
      getQueue: jest.fn().mockResolvedValue({ orders: [], photoCatalog: {} }),
      openOrder: jest.fn().mockResolvedValue({ orderId: 'order-1' }),
      markDone: jest.fn().mockResolvedValue({ success: true }),
      markHold: jest.fn().mockResolvedValue({ success: true }),
      releaseLock: jest.fn().mockResolvedValue({ success: true }),
      getActiveLocks: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({ packed: 0, held: 0, pending: 0 }),
      getHistory: jest.fn().mockResolvedValue([]),
      checkOrderStatus: jest.fn().mockResolvedValue({ exists: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PackingController],
      providers: [{ provide: PackingService, useValue: svc }],
    }).compile();

    controller = module.get<PackingController>(PackingController);
  });

  afterEach(() => jest.clearAllMocks());

  const admin = { userId: 'admin-1', role: 'admin' };
  const assistant = { userId: 'packer-1', role: 'packing_assistant' };

  describe('getQueue', () => {
    it('passes the search query through', async () => {
      await controller.getQueue({ search: 'ORD-123' } as any);
      expect(svc.getQueue).toHaveBeenCalledWith('ORD-123');
    });

    it('returns the { orders, photoCatalog } envelope', async () => {
      await expect(
        controller.getQueue({} as any),
      ).resolves.toEqual({ orders: [], photoCatalog: {} });
    });
  });

  describe('openOrder', () => {
    it('passes the order id and the caller userId', async () => {
      await controller.openOrder('order-1', assistant);
      expect(svc.openOrder).toHaveBeenCalledWith('order-1', 'packer-1');
    });
  });

  describe('markDone', () => {
    it('passes the verification mode and caller userId', async () => {
      await controller.markDone('order-1', 'strict_scan', assistant);
      expect(svc.markDone).toHaveBeenCalledWith(
        'order-1',
        'packer-1',
        'strict_scan',
      );
    });
  });

  describe('markHold', () => {
    it('passes the reason and notes through', async () => {
      await controller.markHold(
        'order-1',
        { reason: 'Missing item', notes: 'left 1' } as any,
        assistant,
      );
      expect(svc.markHold).toHaveBeenCalledWith(
        'order-1',
        'packer-1',
        'Missing item',
        'left 1',
      );
    });
  });

  describe('releaseLock', () => {
    it('passes the order id and caller userId', async () => {
      await controller.releaseLock('order-1', assistant);
      expect(svc.releaseLock).toHaveBeenCalledWith('order-1', 'packer-1');
    });
  });

  describe('getStats', () => {
    it('returns global stats for an admin asking with all=true', async () => {
      await controller.getStats(admin, 'true');
      expect(svc.getStats).toHaveBeenCalledWith();
    });

    it('scopes to the caller for a packing assistant even with all=true', async () => {
      await controller.getStats(assistant, 'true');
      expect(svc.getStats).toHaveBeenCalledWith('packer-1');
    });

    it('scopes to the caller when all is absent', async () => {
      await controller.getStats(assistant, undefined);
      expect(svc.getStats).toHaveBeenCalledWith('packer-1');
    });
  });

  describe('checkOrderStatus', () => {
    it('passes the scanned code through', async () => {
      await controller.checkOrderStatus('ORD-1');
      expect(svc.checkOrderStatus).toHaveBeenCalledWith('ORD-1');
    });
  });

  describe('getHistory', () => {
    it('passes the optional packerId through', async () => {
      await controller.getHistory('packer-1');
      expect(svc.getHistory).toHaveBeenCalledWith('packer-1');
    });
  });
});