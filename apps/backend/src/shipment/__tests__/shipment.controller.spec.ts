import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ShipmentController } from '../shipment.controller';

describe('ShipmentController', () => {
  it('has RequiresFeature(admin_shipments) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      ShipmentController,
    );
    expect(featureKey).toBe('admin_shipments');
  });
});
