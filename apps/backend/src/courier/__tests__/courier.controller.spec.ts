import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CourierController } from '../courier.controller';

describe('CourierController', () => {
  it('has RequiresFeature(admin_courier) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, CourierController);
    expect(featureKey).toBe('admin_courier');
  });
});
