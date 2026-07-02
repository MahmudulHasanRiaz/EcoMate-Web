import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { BlockSettingsController } from '../block-settings.controller';

describe('BlockSettingsController', () => {
  it('has RequiresFeature(admin_blocking) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      BlockSettingsController,
    );
    expect(featureKey).toBe('admin_blocking');
  });
});
