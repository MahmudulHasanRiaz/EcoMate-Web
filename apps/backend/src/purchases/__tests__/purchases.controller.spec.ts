import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { PurchasesController } from '../purchases.controller';

describe('PurchasesController', () => {
  it('has RequiresFeature(admin_purchases) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, PurchasesController);
    expect(featureKey).toBe('admin_purchases');
  });
});
