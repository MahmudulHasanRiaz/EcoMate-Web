import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GatewayConfigController } from '../gateway-config.controller';

const assetLeaf = {
  id: 'acc-cash',
  code: '1001',
  name: 'Cash',
  type: 'asset',
  isGroup: false,
  isActive: true,
};

function controllerWith(overrides: any = {}) {
  const prisma: any = {
    account: { findUnique: jest.fn(), create: jest.fn() },
    paymentGateway: {
      upsert: jest.fn().mockResolvedValue({ id: 'gw-1' }),
      create: jest.fn().mockResolvedValue({ id: 'gw-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      // D6: upsertGateway pre-checks existence to detect a genuine create.
      findUnique: jest.fn().mockResolvedValue({ id: 'gw-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    paymentOption: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return { controller: new GatewayConfigController(prisma), prisma };
}

describe('GatewayConfigController — Part 1 settlement account', () => {
  it('accepts an active, non-group asset leaf and stores accountId', async () => {
    const { controller, prisma } = controllerWith();
    prisma.account.findUnique.mockResolvedValue(assetLeaf);

    await controller.upsertGateway('bkash', {
      name: 'bKash',
      type: 'manual',
      paymentOptionType: 'FULL_PAYMENT',
      accountId: 'acc-cash',
    });

    expect(prisma.paymentGateway.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'bkash' },
        update: expect.objectContaining({ accountId: 'acc-cash' }),
        create: expect.objectContaining({ accountId: 'acc-cash' }),
      }),
    );
  });

  it('clears the mapping when accountId is explicitly null', async () => {
    const { controller, prisma } = controllerWith();

    await controller.upsertGateway('bkash', {
      name: 'bKash',
      type: 'manual',
      paymentOptionType: 'FULL_PAYMENT',
      accountId: null,
    });

    expect(prisma.account.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentGateway.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ accountId: null }),
      }),
    );
  });

  it('leaves the existing mapping untouched when accountId is absent', async () => {
    const { controller, prisma } = controllerWith();

    await controller.upsertGateway('bkash', {
      name: 'bKash',
      type: 'manual',
      paymentOptionType: 'FULL_PAYMENT',
    });

    const call = prisma.paymentGateway.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('accountId');
  });

  it('rejects a missing account', async () => {
    const { controller, prisma } = controllerWith();
    prisma.account.findUnique.mockResolvedValue(null);

    await expect(
      controller.upsertGateway('bkash', {
        name: 'bKash',
        type: 'manual',
        paymentOptionType: 'FULL_PAYMENT',
        accountId: 'missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.paymentGateway.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['group asset', { ...assetLeaf, isGroup: true }],
    ['income', { ...assetLeaf, type: 'income' }],
    ['expense', { ...assetLeaf, type: 'expense' }],
    ['inactive', { ...assetLeaf, isActive: false }],
  ])('rejects a %s account', async (_label, account) => {
    const { controller, prisma } = controllerWith();
    prisma.account.findUnique.mockResolvedValue(account);

    await expect(
      controller.upsertGateway('bkash', {
        name: 'bKash',
        type: 'manual',
        paymentOptionType: 'FULL_PAYMENT',
        accountId: 'acc-bad',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.paymentGateway.upsert).not.toHaveBeenCalled();
  });

  it('validates the account on create too', async () => {
    const { controller, prisma } = controllerWith();
    prisma.account.findUnique.mockResolvedValue({ ...assetLeaf, type: 'income' });

    await expect(
      controller.createGateway({
        code: 'bkash',
        name: 'bKash',
        type: 'manual',
        paymentOptionType: 'FULL_PAYMENT',
        accountId: 'acc-bad',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.paymentGateway.create).not.toHaveBeenCalled();
  });

  it('returns accountId + account on the admin list', async () => {
    const { controller, prisma } = controllerWith();
    prisma.paymentGateway.findMany.mockResolvedValue([
      {
        id: 'gw-1',
        code: 'bkash',
        name: 'bKash',
        type: 'manual',
        paymentOptionType: 'FULL_PAYMENT',
        paymentOption: { name: 'Full Payment', enabled: true },
        enabled: true,
        mode: 'personal',
        phoneNumber: '01700000000',
        accountId: 'acc-cash',
        account: { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset' },
        credentials: {},
        sortOrder: 1,
        staffAutoVerifiedOverride: null,
        editAllowedOverride: null,
      },
    ]);

    const rows = await controller.findAllAdmin();
    expect(rows[0]).toMatchObject({
      accountId: 'acc-cash',
      account: { id: 'acc-cash', name: 'Cash' },
      paymentOptionEnabled: true,
    });
  });
});
