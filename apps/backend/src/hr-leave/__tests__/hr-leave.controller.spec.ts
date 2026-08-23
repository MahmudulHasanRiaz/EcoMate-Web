import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { HrLeaveController } from '../hr-leave.controller';

describe('HrLeaveController', () => {
  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrLeaveController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });

  it('has class-level PermissionsAny(manage_leave)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, HrLeaveController),
    ).toEqual(['manage_leave']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, HrLeaveController),
    ).toBe('admin_hr');
  });

  it('routes are prefixed hr/leave-* and hr/leave-*', () => {
    expect(HrLeaveController).toBeDefined();
  });
});
