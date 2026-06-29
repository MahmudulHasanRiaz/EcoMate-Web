import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AccountingController } from '../accounting.controller';

describe('AccountingController', () => {
  it('has RequiresFeature(admin_accounting) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, AccountingController);
    expect(featureKey).toBe('admin_accounting');
  });
});
