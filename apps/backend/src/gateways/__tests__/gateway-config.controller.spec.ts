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
    // The admin CRUD endpoint (findAllAdmin) keeps credentials in its
    // response and stays admin-only — the payment-form mapper must not
    // copy that field. Asserted on the source: the mapper's key list.
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
