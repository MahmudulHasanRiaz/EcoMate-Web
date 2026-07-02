import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { PayrollController } from '../payroll.controller';

describe('PayrollController', () => {
  it('has RequiresFeature(admin_payroll) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      PayrollController,
    );
    expect(featureKey).toBe('admin_payroll');
  });
});
