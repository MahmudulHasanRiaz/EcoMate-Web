import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SettingsController } from '../settings.controller';

describe('SettingsController', () => {
  it('has RequiresFeature(admin_settings) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SettingsController);
    expect(featureKey).toBe('admin_settings');
  });
});
