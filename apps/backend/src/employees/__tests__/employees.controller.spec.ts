import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { EmployeesController } from '../employees.controller';

describe('EmployeesController', () => {
  it('has RequiresFeature(admin_employees) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, EmployeesController);
    expect(featureKey).toBe('admin_employees');
  });
});
