import { GatewayConfigController } from '../gateway-config.controller';

// D17: the staff-safe payment-form list must carry exactly the fields a
// payment form selects on — and nothing sensitive. The admin CRUD endpoint
// (findAllAdmin) returns raw gateway credentials, which is why it stays
// admin-only; this spec pins the payment-form mapper to its safe shape.
function controllerWith(gateways: any[]) {
  const prisma: any = {
    paymentGateway: { findMany: jest.fn().mockResolvedValue(gateways) },
  };
  return { controller: new GatewayConfigController(prisma), prisma };
}

const cashRow = {
  id: 'gw-cash',
  code: 'cash',
  name: 'Cash',
  type: 'cash',
  paymentOptionType: 'CASH_ON_DELIVERY',
  enabled: true,
  showOnAdmin: true,
  logoUrl: null,
  phoneNumber: null,
  accountId: 'acc-cash',
  account: { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset', isActive: true },
  credentials: { secret: 'MUST-NOT-LEAK' },
  staffAutoVerifiedOverride: true,
  editAllowedOverride: false,
};

describe('GatewayConfigController — D17 payment-form list', () => {
  it('queries only enabled gateways and strips credentials + overrides', async () => {
    const { controller, prisma } = controllerWith([cashRow]);
    const rows = await controller.findAllForPaymentForm();
    expect(prisma.paymentGateway.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 'gw-cash',
      code: 'cash',
      name: 'Cash',
      type: 'cash',
      paymentOptionType: 'CASH_ON_DELIVERY',
      enabled: true,
      showOnAdmin: true,
      logoUrl: null,
      phoneNumber: null,
      accountId: 'acc-cash',
      account: { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset' },
    });
    expect(rows[0]).not.toHaveProperty('credentials');
    expect(rows[0]).not.toHaveProperty('staffAutoVerifiedOverride');
    expect(rows[0]).not.toHaveProperty('editAllowedOverride');
  });

  it('reads a deactivated mapped account as unmapped (stale-mapping warning path)', async () => {
    const { controller } = controllerWith([
      {
        ...cashRow,
        account: { ...cashRow.account, isActive: false },
      },
    ]);
    const rows = await controller.findAllForPaymentForm();
    expect(rows[0].account).toBeNull();
    expect(rows[0].accountId).toBe('acc-cash');
  });
});
