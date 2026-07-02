import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { GatewayConfigController } from '../gateway-config.controller';

describe('GatewayConfigController', () => {
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
});
