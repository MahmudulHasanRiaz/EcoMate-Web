import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { HrLedgersController } from '../hr-ledgers.controller';

describe('HrLedgersController', () => {
  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrLedgersController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });

  it('has class-level PermissionsAny(manage_payroll, manage_employees)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, HrLedgersController),
    ).toEqual(['manage_payroll', 'manage_employees']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, HrLedgersController)).toBe(
      'admin_hr',
    );
  });

  it('has no handler-level permission overrides (inherits class)', () => {
    for (const handler of [
      'createEarning',
      'findEarnings',
      'approveEarning',
      'createDeduction',
      'findDeductions',
      'approveDeduction',
    ]) {
      const fn = (HrLedgersController.prototype as any)[handler];
      expect(fn).toBeDefined();
      expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, fn)).toBeUndefined();
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toBeUndefined();
    }
  });
});
