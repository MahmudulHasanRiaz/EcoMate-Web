import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { MediaController } from '../media.controller';

describe('MediaController', () => {
  it('has RequiresFeature(admin_media) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, MediaController);
    expect(featureKey).toBe('admin_media');
  });
});
