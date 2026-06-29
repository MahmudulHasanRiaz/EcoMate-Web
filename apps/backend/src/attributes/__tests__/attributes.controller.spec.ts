import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AttributesController } from '../attributes.controller';

describe('AttributesController', () => {
  it('has RequiresFeature(admin_attributes) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, AttributesController);
    expect(featureKey).toBe('admin_attributes');
  });
});
