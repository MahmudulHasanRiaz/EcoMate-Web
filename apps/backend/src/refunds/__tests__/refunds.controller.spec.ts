import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { RefundsController } from '../refunds.controller';

describe('RefundsController', () => {
  it('has RequiresFeature(admin_refunds) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      RefundsController,
    );
    expect(featureKey).toBe('admin_refunds');
  });
});
