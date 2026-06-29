import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SuppliersController } from '../suppliers.controller';

describe('SuppliersController', () => {
  it('has RequiresFeature(admin_suppliers) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, SuppliersController);
    expect(featureKey).toBe('admin_suppliers');
  });
});
