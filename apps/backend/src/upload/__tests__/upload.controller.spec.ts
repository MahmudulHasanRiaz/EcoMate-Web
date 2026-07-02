import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { UploadController } from '../upload.controller';

describe('UploadController', () => {
  it('has RequiresFeature(admin_media) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      UploadController,
    );
    expect(featureKey).toBe('admin_media');
  });
});
