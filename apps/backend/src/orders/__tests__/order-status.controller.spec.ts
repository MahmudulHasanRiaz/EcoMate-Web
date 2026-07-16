import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { OrderStatusController } from '../order-status.controller';

describe('OrderStatusController', () => {
  it('has RequiresFeature(admin_orders) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      OrderStatusController,
    );
    expect(featureKey).toBe('admin_orders');
  });
});
