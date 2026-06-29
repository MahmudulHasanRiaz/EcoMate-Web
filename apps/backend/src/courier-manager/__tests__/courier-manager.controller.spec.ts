import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CourierManagerController } from '../courier-manager.controller';

describe('CourierManagerController', () => {
  it('has RequiresFeature(admin_courier) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, CourierManagerController);
    expect(featureKey).toBe('admin_courier');
  });
});
