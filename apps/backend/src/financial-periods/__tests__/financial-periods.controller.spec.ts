import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { FinancialPeriodsController } from '../financial-periods.controller';

describe('FinancialPeriodsController', () => {
  it('has RequiresFeature(admin_accounting) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, FinancialPeriodsController);
    expect(featureKey).toBe('admin_accounting');
  });
});
