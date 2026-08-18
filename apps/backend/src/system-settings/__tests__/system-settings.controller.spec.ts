import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SystemSettingsController } from '../system-settings.controller';

describe('SystemSettingsController', () => {
  it('adds RequiresFeature(admin_settings) on getAll', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getAll,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getStorageConfig', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getStorageConfig,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on set', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.set,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getSmtpSettings', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getSmtpSettings,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on updateSmtpSettings', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.updateSmtpSettings,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on testSmtp', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.testSmtp,
    );
    expect(meta).toBe('admin_settings');
  });

  it('does not add RequiresFeature on public getPublicBranding', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getPublicBranding,
    );
    expect(meta).toBeUndefined();
  });

  it('does not add RequiresFeature on public getStorefrontConfig', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getStorefrontConfig,
    );
    expect(meta).toBeUndefined();
  });

  describe('getStorefrontConfig blocked-phone message', () => {
    function mockController(
      settings: { key: string; value: string }[] = [],
    ) {
      const prisma = {
        systemSetting: { findMany: jest.fn().mockResolvedValue(settings) },
        shippingOption: { findMany: jest.fn().mockResolvedValue([]) },
        shippingZoneGroup: { findMany: jest.fn().mockResolvedValue([]) },
        paymentOption: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const cache = {
        get: jest.fn().mockResolvedValue(null),
        getStale: jest.fn(),
        set: jest.fn(),
      };
      return new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        cache as any,
        {} as any,
      );
    }

    it('falls back to the default message when no key is configured', async () => {
      const cfg = await mockController().getStorefrontConfig();
      expect(cfg.order.blockedPhoneMessage).toBe(
        'This phone number has been blocked. Please contact support.',
      );
    });

    it('uses the configured blocked_phone_message value', async () => {
      const ctrl = mockController([
        { key: 'blocked_phone_message', value: 'Your number is on hold. Call us.' },
      ]);
      const cfg = await ctrl.getStorefrontConfig();
      expect(cfg.order.blockedPhoneMessage).toBe(
        'Your number is on hold. Call us.',
      );
    });
  });
});
