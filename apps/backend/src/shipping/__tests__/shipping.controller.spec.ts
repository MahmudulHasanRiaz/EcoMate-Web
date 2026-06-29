import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ShippingController } from '../shipping.controller';

describe('ShippingController', () => {
  it('has RequiresFeature(admin_shipments) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, ShippingController);
    expect(featureKey).toBe('admin_shipments');
  });
});
