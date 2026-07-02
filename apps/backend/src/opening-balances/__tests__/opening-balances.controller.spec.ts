import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { OpeningBalancesController } from '../opening-balances.controller';

describe('OpeningBalancesController', () => {
  it('has RequiresFeature(admin_accounting) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      OpeningBalancesController,
    );
    expect(featureKey).toBe('admin_accounting');
  });
});
