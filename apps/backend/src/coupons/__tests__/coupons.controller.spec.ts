import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CouponsController } from '../coupons.controller';

describe('CouponsController', () => {
  it('has RequiresFeature(admin_coupons) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, CouponsController);
    expect(featureKey).toBe('admin_coupons');
  });
});
