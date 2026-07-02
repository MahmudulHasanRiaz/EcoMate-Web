import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CustomersController } from '../customers.controller';

describe('CustomersController', () => {
  it('has RequiresFeature(admin_customers) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      CustomersController,
    );
    expect(featureKey).toBe('admin_customers');
  });
});
