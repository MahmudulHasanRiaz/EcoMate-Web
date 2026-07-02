import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AccountsController } from '../accounts.controller';

describe('AccountsController', () => {
  it('has RequiresFeature(admin_accounting) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      AccountsController,
    );
    expect(featureKey).toBe('admin_accounting');
  });
});
