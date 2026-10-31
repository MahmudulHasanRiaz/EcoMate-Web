import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomersService } from '../customers.service';

const PrismaServiceToken = PrismaService;

describe('CustomersService.findOrCreateCustomer — email identity rules (spec §14-16)', () => {
  let service: CustomersService;
  const prisma = {
    customerProfile: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
    },
    customerPhone: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    orderStatus: { findMany: jest.fn().mockResolvedValue([]) },
    blockedPhone: { findMany: jest.fn().mockResolvedValue([]) },
    blockedIp: { findMany: jest.fn().mockResolvedValue([]) },
    customerAddress: { findMany: jest.fn().mockResolvedValue([]) },
    userProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userSettings: { create: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaServiceToken, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://myeco.store') } },
      ],
    }).compile();
    service = moduleRef.get(CustomersService);
  });

  it('stores a real guest email on an existing phone-based profile (replacing a temporary one)', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'cust-1',
      phone: '+8801812345678',
      // Exactly what the generator emits: digits of the NORMALISED (E.164)
      // phone, which carries the 880 country code.
      email: 'cust_8801812345678@myeco.store',
    });
    prisma.userProfile.findFirst.mockResolvedValue(null);

    await service.findOrCreateCustomer(
      '01812345678',
      'Jane Doe',
      '1.2.3.4',
      'jane@example.com',
    );

    expect(prisma.customerProfile.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { email: 'jane@example.com' },
    });
  });

  it('never replaces a REAL profile email with a different real email', async () => {
    // The customer already gave us a real address. A later order supplying a
    // different one is not permission to rewrite their identity — that stays an
    // explicit profile-edit decision (Part 19 / Rule 5).
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'cust-1',
      phone: '+8801812345678',
      email: 'real-before@example.com',
    });
    prisma.userProfile.findFirst.mockResolvedValue(null);

    const result = await service.findOrCreateCustomer(
      '01812345678',
      'Jane Doe',
      undefined,
      'new-real@example.com',
    );

    expect(prisma.customerProfile.create).not.toHaveBeenCalled();
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    expect(result.id).toBe('cust-1');
  });

  it('keeps a real profile email when no email is supplied (no synthetic overwrite)', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'cust-1',
      phone: '+8801812345678',
      email: 'real@example.com',
    });
    prisma.userProfile.findFirst.mockResolvedValue(null);

    await service.findOrCreateCustomer('01812345678', 'Jane Doe');

    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
  });

  it('creates a synthetic cust_ email only when the guest provides none', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue(null);
    prisma.userProfile.findFirst.mockResolvedValue(null);
    prisma.userProfile.create.mockResolvedValue({ id: 'new-user' });
    prisma.userSettings.create.mockResolvedValue({});
    prisma.customerProfile.create.mockResolvedValue({ id: 'new-user' });

    await service.findOrCreateCustomer('01812345678', 'Jane Doe');

    const createdUser = prisma.userProfile.create.mock.calls[0][0].data;
    expect(createdUser.email).toMatch(/^cust_\d+@myeco\.store$/);
    // Real guest email is preferred over the synthetic one.
    expect(createdUser.role).toBe('customer');
  });

  it('uses the provided real email for brand-new customers (no synthetic)', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue(null);
    prisma.userProfile.findFirst.mockResolvedValue(null);
    prisma.userProfile.create.mockResolvedValue({ id: 'new-user' });
    prisma.userSettings.create.mockResolvedValue({});
    prisma.customerProfile.create.mockResolvedValue({ id: 'new-user' });

    await service.findOrCreateCustomer(
      '01812345678',
      'Jane Doe',
      undefined,
      'jane@example.com',
    );

    const createdUser = prisma.userProfile.create.mock.calls[0][0].data;
    expect(createdUser.email).toBe('jane@example.com');
  });

  it('replaces a synthetic profile email with the real email a later order supplies (spec §15)', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'cust-1',
      phone: '+8801712345678',
      email: 'cust_8801712345678@myeco.store',
    });
    prisma.userProfile.findFirst.mockResolvedValue(null);

    await service.findOrCreateCustomer(
      '01712345678',
      'Rahim Uddin',
      undefined,
      'rahim@example.com',
    );

    expect(prisma.customerProfile.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { email: 'rahim@example.com' },
    });
  });

  it('never replaces a synthetic-shaped email belonging to a DIFFERENT phone', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'cust-1',
      phone: '+8801712345678',
      email: 'cust_8809999999999@myeco.store', // another customer's placeholder
    });
    prisma.userProfile.findFirst.mockResolvedValue(null);

    await service.findOrCreateCustomer(
      '01712345678',
      'Rahim Uddin',
      undefined,
      'rahim@example.com',
    );

    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
  });

  it('does not rename an existing customer on a repeat checkout', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'cust-1',
      phone: '+8801712345678',
      email: 'real@example.com',
    });
    prisma.userProfile.findFirst.mockResolvedValue({ id: 'u-1', firstName: 'Rahim', lastName: 'Uddin' });

    await service.findOrCreateCustomer('01712345678', 'Md Rahim');

    // The second order's name is order-owned, not customer-owned.
    expect(prisma.userProfile.update).not.toHaveBeenCalled();
  });
});
describe('CustomersService — linked phone numbers (CustomerPhone)', () => {
  let service: CustomersService;
  const prisma: any = {
    customerProfile: { findUnique: jest.fn() },
    customerPhone: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userProfile: { findUnique: jest.fn(), findFirst: jest.fn() },
    order: {
      aggregate: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    orderStatus: { findMany: jest.fn().mockResolvedValue([]) },
    blockedPhone: { findMany: jest.fn().mockResolvedValue([]) },
    blockedIp: { findMany: jest.fn().mockResolvedValue([]) },
    customerAddress: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.customerPhone.findMany.mockResolvedValue([]);
    prisma.customerPhone.findUnique.mockResolvedValue(null);    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaServiceToken, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://myeco.store') } },
      ],
    }).compile();
    service = moduleRef.get(CustomersService);
  });

  it('links a new secondary number to the customer', async () => {
    const linked = await service.linkPhones('cust-1', ['01800000002'], 'secondary');

    expect(linked).toEqual(['+8801800000002']);
    expect(prisma.customerPhone.create).toHaveBeenCalledWith({
      data: { customerProfileId: 'cust-1', phone: '+8801800000002', source: 'secondary' },
    });
  });

  it('is idempotent for an already-linked number', async () => {
    prisma.customerPhone.findUnique.mockResolvedValue({ customerProfileId: 'cust-1' });

    const linked = await service.linkPhones('cust-1', ['01800000002'], 'secondary');

    expect(linked).toEqual(['+8801800000002']);
    expect(prisma.customerPhone.create).not.toHaveBeenCalled();
  });

  it('refuses a number owned by another customer (never merges)', async () => {
    prisma.customerPhone.findUnique.mockResolvedValue({ customerProfileId: 'cust-OTHER' });

    await expect(service.linkPhones('cust-1', ['01800000002'], 'secondary')).rejects.toThrow(
      'already linked to another customer',
    );
    expect(prisma.customerPhone.create).not.toHaveBeenCalled();
  });

  it('resolves a customer id from a secondary number', async () => {
    prisma.customerPhone.findMany.mockResolvedValue([
      { phone: '+8801800000002', customerProfileId: 'cust-1' },
    ]);

    await expect(service.resolveCustomerIdByPhones(['01800000002'])).resolves.toEqual({
      customerId: 'cust-1',
      conflicted: false,
    });
  });

  it('flags conflicted numbers instead of silently picking', async () => {
    prisma.customerPhone.findMany.mockResolvedValue([
      { phone: '+8801812345678', customerProfileId: 'cust-A' },
      { phone: '+8801800000002', customerProfileId: 'cust-B' },
    ]);

    await expect(
      service.resolveCustomerIdByPhones(['01812345678', '01800000002']),
    ).resolves.toEqual({ customerId: 'cust-A', conflicted: true });
  });

  it('findOne returns only the customer IPs with block state (never global)', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      id: 'cust-1', firstName: 'Jane', lastName: 'Doe', username: 'cust_x',
      email: null, phoneNumber: '+8801812345678', lastIp: '9.9.9.9',
      status: 'active', role: 'customer', createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.order.aggregate.mockResolvedValue({ _count: 2, _sum: { total: 500 } });
    (prisma.order.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'o1', displayId: 'ORD-1', total: 300, statusId: 's1', createdAt: new Date(), status: { name: 'Delivered', color: '#0f0' } },
      ])
      .mockResolvedValueOnce([
        { ipAddress: '1.1.1.1', createdAt: new Date('2026-01-02'), displayId: 'ORD-1' },
        { ipAddress: '1.1.1.1', createdAt: new Date('2026-01-01'), displayId: 'ORD-2' },
        { ipAddress: '2.2.2.2', createdAt: new Date('2026-01-03'), displayId: 'ORD-3' },
      ]);
    prisma.customerProfile.findUnique.mockResolvedValue({ lastOrderIp: null });
    prisma.blockedIp.findMany.mockResolvedValue([{ id: 'b1', ip: '2.2.2.2', reason: 'fraud' }]);

    const result = await service.findOne('cust-1');

    expect(result?.ips).toHaveLength(3); // 2 order IPs + lastIp telemetry
    const blocked = result?.ips.find((i: any) => i.ip === '2.2.2.2');
    expect(blocked).toMatchObject({ blocked: true, blockId: 'b1', orderCount: 1 });
    const own = result?.ips.find((i: any) => i.ip === '1.1.1.1');
    expect(own).toMatchObject({ blocked: false, blockId: null, orderCount: 2 });
    // No address from another customer can appear: only this customer's rows.
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: 'cust-1' }) }),
    );
    expect(result?.stats).toMatchObject({ delivered: 0, cancelled: 0, successRate: 0 });
    expect(result?.summary).toMatchObject({ totalOrders: 2, totalSpent: 500 });
  });

  it('findOne reads phone/IP block state with the LIVE predicate (active, not whitelisted, not expired) — 2026-10-31', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      id: 'cust-1', firstName: 'Jane', lastName: 'Doe', username: 'cust_x',
      email: null, phoneNumber: '+8801812345678', lastIp: null,
      status: 'active', role: 'customer', createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.order.aggregate.mockResolvedValue({ _count: 0, _sum: { total: 0 } });
    prisma.customerProfile.findUnique.mockResolvedValue({
      phone: '+8801812345678',
      lastOrderIp: null,
    });
    prisma.customerPhone.findMany.mockResolvedValue([]);
    prisma.blockedPhone.findMany.mockResolvedValue([]);
    prisma.blockedIp.findMany.mockResolvedValue([]);

    const result = await service.findOne('cust-1');

    // The historical bug: this query matched ANY BlockedPhone row (even
    // unblocked/expired), so numbers showed "Blocked" forever.
    expect(prisma.blockedPhone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phone: { in: ['+8801812345678'] },
          isActive: true,
          whitelisted: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
    expect(result?.phones[0]).toMatchObject({
      phone: '+8801812345678',
      blocked: false,
      blockId: null,
    });
  });
});
