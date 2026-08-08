import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderEditLockService } from './order-edit-lock.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrderEditLockService', () => {
  let service: OrderEditLockService;
  let prisma: any;

  const liveLock = {
    orderId: 'order-1',
    userId: 'user-a',
    acquiredAt: new Date(),
    heartbeatAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const expiredLock = {
    ...liveLock,
    expiresAt: new Date(Date.now() - 5_000),
  };

  const mockPrisma = () => ({
    orderEditLock: {
      create: jest.fn().mockResolvedValue(liveLock),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue({ id: 'order-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    userProfile: {
      findUnique: jest.fn().mockResolvedValue({
        firstName: 'Ayesha',
        lastName: 'Khan',
      }),
    },
  });

  beforeEach(async () => {
    prisma = mockPrisma();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderEditLockService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(OrderEditLockService);
  });

  it('acquires a free lock', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(null);
    prisma.orderEditLock.create.mockResolvedValue(liveLock);

    const result = await service.acquire('order-1', 'user-a');
    expect(result.acquired).toBe(true);
    if (result.acquired) expect(result.lock.userId).toBe('user-a');
  });

  it('re-acquires (refreshes) when the caller already owns the lock', async () => {
    prisma.orderEditLock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);
    prisma.orderEditLock.update.mockResolvedValue({
      ...liveLock,
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.acquire('order-1', 'user-a');
    expect(result.acquired).toBe(true);
  });

  it('returns heldBy without throwing when another user holds a live lock', async () => {
    prisma.orderEditLock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);

    const result = await service.acquire('order-1', 'user-b');
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.heldBy.userId).toBe('user-a');
      expect(result.heldBy.userName).toBe('Ayesha Khan');
    }
    expect(prisma.orderEditLock.update).not.toHaveBeenCalled();
  });

  it('takes over an expired lock and audits the takeover', async () => {
    prisma.orderEditLock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    prisma.orderEditLock.findUnique.mockResolvedValue(expiredLock);
    prisma.orderEditLock.update.mockResolvedValue({
      ...expiredLock,
      userId: 'user-b',
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      timeline: [],
    });

    const result = await service.acquire('order-1', 'user-b');
    expect(result.acquired).toBe(true);
    expect(prisma.orderEditLock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'order-1' },
        data: expect.objectContaining({ userId: 'user-b' }),
      }),
    );
    // Audit entry appended to the order timeline.
    const timelineUpdate = prisma.order.update.mock.calls[0][0];
    expect(timelineUpdate.data.timeline[0].type).toBe('edit_lock');
  });

  it('returns heldBy when a create races with another holder', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);
    prisma.orderEditLock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );

    const result = await service.acquire('order-1', 'user-b');
    expect(result.acquired).toBe(false);
    if (!result.acquired) expect(result.heldBy.userId).toBe('user-a');
  });

  it('throws NotFound when the order does not exist', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(service.acquire('nope', 'user-a')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('renews the TTL on heartbeat for the owner', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);
    prisma.orderEditLock.update.mockResolvedValue({
      ...liveLock,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.heartbeat('order-1', 'user-a');
    expect(result.ok).toBe(true);
    expect(prisma.orderEditLock.update).toHaveBeenCalled();
  });

  it('reports ownership loss on heartbeat from a non-holder', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);
    const result = await service.heartbeat('order-1', 'user-b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.heldBy.userId).toBe('user-a');
  });

  it('release succeeds for the holder and deletes the row', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);
    prisma.orderEditLock.delete.mockResolvedValue(liveLock);

    const result = await service.release('order-1', 'user-a');
    expect(result.released).toBe(true);
    expect(prisma.orderEditLock.delete).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
    });
  });

  it('release refuses when another user holds the lock', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(liveLock);
    await expect(service.release('order-1', 'user-b')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.orderEditLock.delete).not.toHaveBeenCalled();
  });

  it('override takes the lock regardless of the current holder', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      timeline: [],
    });
    prisma.orderEditLock.upsert.mockResolvedValue({
      ...liveLock,
      userId: 'user-b',
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const lock = await service.override('order-1', 'user-b');
    expect(lock.userId).toBe('user-b');
    expect(prisma.orderEditLock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'order-1' },
        create: expect.objectContaining({ userId: 'user-b' }),
      }),
    );
    const timelineUpdate = prisma.order.update.mock.calls[0][0];
    expect(timelineUpdate.data.timeline[0].note).toContain('overridden');
  });

  it('getLock returns null when the lock is expired', async () => {
    prisma.orderEditLock.findUnique.mockResolvedValue(expiredLock);
    const lock = await service.getLock('order-1');
    expect(lock).toBeNull();
  });
});
