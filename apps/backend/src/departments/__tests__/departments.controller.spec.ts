import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { DepartmentsController } from '../departments.controller';

describe('DepartmentsController', () => {
  it('has RequiresFeature(admin_employees) metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, DepartmentsController),
    ).toBe('admin_employees');
  });

  it('has class-level Roles metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DepartmentsController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });
});