import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SystemSettingsController } from '../system-settings.controller';

describe('SystemSettingsController', () => {
  it('adds RequiresFeature(admin_settings) on getAll', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.getAll);
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getStorageConfig', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.getStorageConfig);
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on set', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.set);
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getSmtpSettings', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.getSmtpSettings);
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on updateSmtpSettings', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.updateSmtpSettings);
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on testSmtp', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.testSmtp);
    expect(meta).toBe('admin_settings');
  });

  it('does not add RequiresFeature on public getPublicBranding', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.getPublicBranding);
    expect(meta).toBeUndefined();
  });

  it('does not add RequiresFeature on public getStorefrontConfig', () => {
    const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SystemSettingsController.prototype.getStorefrontConfig);
    expect(meta).toBeUndefined();
  });
});
