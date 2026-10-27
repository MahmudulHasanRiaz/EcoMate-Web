import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { GatewayConfigController } from '../gateway-config.controller';

describe('GatewayConfigController', () => {
  it('adds RequiresFeature(admin_payments) on findAllForPaymentForm', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findAllForPaymentForm,
    );
    expect(meta).toBe('admin_payments');
  });

  it('D17: payment-form list is readable by employee staff AND never exposes credentials', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      GatewayConfigController.prototype.findAllForPaymentForm,
    );
    expect(roles).toEqual(['superadmin', 'admin', 'employee']);
    // The admin CRUD endpoints return keys-only (F8) and stay admin-only —
    // the payment-form mapper must not copy credential fields. Asserted
    // on the source: the mapper's key list.
    const src = GatewayConfigController.prototype.findAllForPaymentForm.toString();
    expect(src).not.toMatch(/credentials/);
    expect(src).toMatch(/showOnAdmin/);
  });
  it('adds RequiresFeature(admin_payments) on findAllOptions', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findAllOptions,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on upsertOption', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.upsertOption,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on findAllAdmin', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findAllAdmin,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on createGateway', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.createGateway,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on upsertGateway', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.upsertGateway,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on findProductOverrides', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findProductOverrides,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on upsertProductOverride', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.upsertProductOverride,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on deleteProductOverride', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.deleteProductOverride,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on findComboOverrides', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findComboOverrides,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on upsertComboOverride', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.upsertComboOverride,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on deleteComboOverride', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.deleteComboOverride,
    );
    expect(meta).toBe('admin_payments');
  });

  it('adds RequiresFeature(admin_payments) on findOne', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findOne,
    );
    expect(meta).toBe('admin_payments');
  });

  it('does not add RequiresFeature on public findAll', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      GatewayConfigController.prototype.findAll,
    );
    expect(meta).toBeUndefined();
  });

  // D7 (owner-locked 2026-10-24): PaymentOption.enabled is a
  // storefront-only flag. The POS surface must ignore it; the website
  // surface must honor it.
  describe('findAll surface filtering (D7)', () => {
    const gatewayRow = {
      id: 'g1',
      code: 'bkash',
      name: 'bKash',
      type: 'manual',
      paymentOptionType: 'FULL_PAYMENT',
      paymentOption: { name: 'Full Payment', enabled: false },
      enabled: true,
      mode: 'personal',
      phoneNumber: null,
      logoUrl: null,
    };
    const makeController = () => {
      const findMany = jest.fn().mockResolvedValue([gatewayRow]);
      const controller = new GatewayConfigController({
        paymentGateway: { findMany },
      } as any);
      return { controller, findMany };
    };

    it('storefront surface (default) honors paymentOption.enabled', async () => {
      const { controller, findMany } = makeController();
      await controller.findAll(undefined);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            enabled: true,
            showOnStorefront: true,
            paymentOption: { enabled: true },
          }),
        }),
      );
    });

    it('POS surface ignores paymentOption.enabled', async () => {
      const { controller, findMany } = makeController();
      const rows = await controller.findAll('pos');
      const where = findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ enabled: true, showOnPos: true }));
      expect(where).not.toHaveProperty('paymentOption');
      expect(rows).toHaveLength(1);
    });
  });
});

// 2026-10-27: GET /gateways/options returned raw credential VALUES nested
// inside each option's gateways (Prisma include without select returns every
// scalar field, including the credentials JSON) — F8 masked the gateway
// routes but missed this endpoint. The admin gateway settings page builds
// its edit form from THIS response, so a stored App Key rendered populated
// even on the masked backend. These tests pin the keys-only shape.
describe('GatewayConfigController — findAllOptions credential masking', () => {
  function controllerWithOptions(options: any[]) {
    const prisma: any = {
      paymentOption: { findMany: jest.fn().mockResolvedValue(options) },
    };
    return { controller: new GatewayConfigController(prisma), prisma };
  }

  const bkashPgwRow = {
    id: 'gw-pgw',
    code: 'bkash_pgw',
    name: 'bKash PGW (API)',
    type: 'api',
    paymentOptionType: 'FULL_PAYMENT',
    enabled: true,
    mode: 'sandbox',
    phoneNumber: null,
    accountId: null,
    account: null,
    credentials: { appKey: 'SECRET-APP-KEY', appSecret: '', username: '', password: '' },
    sortOrder: 7,
  };

  it('never returns credential VALUES in nested gateways — keys-only, like findAllAdmin', async () => {
    const { controller } = controllerWithOptions([
      { id: 'opt-full', type: 'FULL_PAYMENT', name: 'Full Payment', sortOrder: 1, gateways: [bkashPgwRow] },
    ]);
    const rows = await controller.findAllOptions();
    expect(rows).toHaveLength(1);
    const g = (rows[0] as any).gateways[0];
    expect(g).not.toHaveProperty('credentials');
    // Only the non-empty key is listed — the stored value itself never leaves the server.
    expect(g.credentialKeys).toEqual(['appKey']);
    expect(JSON.stringify(rows)).not.toContain('SECRET-APP-KEY');
    // Non-credential fields pass through untouched.
    expect(g.code).toBe('bkash_pgw');
    expect(g.mode).toBe('sandbox');
  });

  it('reports empty credentialKeys when no credentials are stored', async () => {
    const { controller } = controllerWithOptions([
      {
        id: 'opt-cod',
        type: 'CASH_ON_DELIVERY',
        name: 'Cash on Delivery',
        sortOrder: 3,
        gateways: [{ ...bkashPgwRow, code: 'cash', credentials: {} }],
      },
    ]);
    const rows = await controller.findAllOptions();
    expect((rows[0] as any).gateways[0].credentialKeys).toEqual([]);
  });
});
