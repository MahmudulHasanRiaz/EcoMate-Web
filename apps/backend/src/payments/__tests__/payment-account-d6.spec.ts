import {
  assertGatewayUsableOnSurface,
  ensureGatewaySettlementAccount,
  gatewaySettlementAccountSpec,
} from '../payment-account';

/**
 * D6 (owner-locked 2026-10-23): per-surface gateway usability + the
 * auto-created namesake settlement accounts.
 */

function gatewayRow(overrides: Record<string, any> = {}) {
  return {
    id: 'gw-1',
    code: 'bkash',
    name: 'bKash (Manual)',
    enabled: true,
    type: 'manual',
    accountId: null,
    showOnStorefront: true,
    showOnAdmin: true,
    showOnPos: true,
    ...overrides,
  };
}

function accountRow(overrides: Record<string, any> = {}) {
  return {
    id: 'acc-1',
    code: 'bkash',
    name: 'bKash (Manual)',
    type: 'asset',
    isGroup: false,
    isActive: true,
    isSystem: true,
    ...overrides,
  };
}

describe('gatewaySettlementAccountSpec', () => {
  it('cash maps to the Cash in Hand account', () => {
    expect(gatewaySettlementAccountSpec({ code: 'cash', name: 'Cash' })).toEqual({
      code: 'cash-in-hand',
      name: 'Cash in Hand',
    });
  });

  it('other gateways use their own code and name', () => {
    expect(
      gatewaySettlementAccountSpec({ code: 'nagad', name: 'Nagad (Manual)' }),
    ).toEqual({ code: 'nagad', name: 'Nagad (Manual)' });
  });
});

describe('ensureGatewaySettlementAccount', () => {
  it('creates the namesake system account and maps an unmapped gateway', async () => {
    const created = accountRow();
    const db = {
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
      paymentGateway: { update: jest.fn().mockResolvedValue({}) },
    };
    const result = await ensureGatewaySettlementAccount(db, gatewayRow());
    expect(db.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'bkash',
        type: 'asset',
        isGroup: false,
        isActive: true,
        isSystem: true,
      }),
    });
    expect(db.paymentGateway.update).toHaveBeenCalledWith({
      where: { id: 'gw-1' },
      data: { accountId: 'acc-1' },
    });
    expect(result).toEqual({ accountId: 'acc-1', created: true, mapped: true });
  });

  it('never re-maps when the account already existed (deliberate clear sticks)', async () => {
    const db = {
      account: {
        findUnique: jest.fn().mockResolvedValue(accountRow()),
        create: jest.fn(),
      },
      paymentGateway: { update: jest.fn() },
    };
    const result = await ensureGatewaySettlementAccount(db, gatewayRow());
    expect(db.account.create).not.toHaveBeenCalled();
    expect(db.paymentGateway.update).not.toHaveBeenCalled();
    expect(result).toEqual({ accountId: null, created: false, mapped: false });
  });

  it('never overrides an existing gateway mapping', async () => {
    const db = {
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(accountRow()),
      },
      paymentGateway: { update: jest.fn() },
    };
    const result = await ensureGatewaySettlementAccount(
      db,
      gatewayRow({ accountId: 'acc-client-own' }),
    );
    expect(db.paymentGateway.update).not.toHaveBeenCalled();
    expect(result.accountId).toBe('acc-client-own');
    expect(result.mapped).toBe(false);
  });

  it('creates the cash account under cash-in-hand', async () => {
    const db = {
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue(accountRow({ id: 'acc-cash', code: 'cash-in-hand', name: 'Cash in Hand' })),
      },
      paymentGateway: { update: jest.fn().mockResolvedValue({}) },
    };
    const result = await ensureGatewaySettlementAccount(
      db,
      gatewayRow({ id: 'gw-cash', code: 'cash', name: 'Cash' }),
    );
    expect(db.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'cash-in-hand', name: 'Cash in Hand' }),
    });
    expect(result).toEqual({ accountId: 'acc-cash', created: true, mapped: true });
  });
});

describe('assertGatewayUsableOnSurface', () => {
  function dbWith(gateway: any) {
    return {
      paymentGateway: {
        findUnique: jest.fn().mockResolvedValue(gateway),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
  }

  it('passes for an enabled, visible gateway', async () => {
    await expect(
      assertGatewayUsableOnSurface(dbWith(gatewayRow()), 'bkash', 'pos'),
    ).resolves.toBeUndefined();
  });

  it('throws when the gateway is hidden on the surface', async () => {
    await expect(
      assertGatewayUsableOnSurface(
        dbWith(gatewayRow({ showOnPos: false })),
        'bkash',
        'pos',
      ),
    ).rejects.toThrow(/not available on POS/);
  });

  it('a POS-hidden gateway is still usable on the storefront', async () => {
    await expect(
      assertGatewayUsableOnSurface(
        dbWith(gatewayRow({ showOnPos: false })),
        'bkash',
        'storefront',
      ),
    ).resolves.toBeUndefined();
  });

  it('throws when the gateway is disabled', async () => {
    await expect(
      assertGatewayUsableOnSurface(
        dbWith(gatewayRow({ enabled: false })),
        'bkash',
        'storefront',
      ),
    ).rejects.toThrow(/is disabled/);
  });

  it('unknown legacy codes pass (history is never blocked)', async () => {
    await expect(
      assertGatewayUsableOnSurface(dbWith(null), 'legacy-label', 'pos'),
    ).resolves.toBeUndefined();
  });
});
