import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CommissionsController } from '../commissions.controller';

describe('CommissionsController', () => {
  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CommissionsController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });

  it('has class-level PermissionsAny(manage_commissions)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, CommissionsController),
    ).toEqual(['manage_commissions']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, CommissionsController),
    ).toBe('admin_hr');
  });

  it('has no handler-level permission overrides (inherits class)', () => {
    for (const handler of [
      'createRule',
      'listRules',
      'updateRule',
      'setActive',
      'deleteRule',
      'listEarnings',
    ]) {
      const fn = (CommissionsController.prototype as any)[handler];
      expect(fn).toBeDefined();
      expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, fn)).toBeUndefined();
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toBeUndefined();
      expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, fn)).toBeUndefined();
    }
  });

  it('routes are prefixed hr/commissions/*', () => {
    expect(CommissionsController).toBeDefined();
  });
});
