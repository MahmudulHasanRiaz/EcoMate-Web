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
      email: 'cust_1812345678@myeco.store', // synthetic/temporary
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

  it('same phone + a new real email updates the existing customer (no second customer)', async () => {
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
    expect(prisma.customerProfile.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { email: 'new-real@example.com' },
    });
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
      email: 'cust_1712345678@myeco.store',
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
});