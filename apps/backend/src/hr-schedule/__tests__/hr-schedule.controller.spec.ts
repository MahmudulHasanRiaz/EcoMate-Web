import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { HrScheduleController } from '../hr-schedule.controller';

describe('HrScheduleController', () => {
  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrScheduleController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });

  it('has class-level PermissionsAny(view_hr) metadata', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, HrScheduleController),
    ).toEqual(['view_hr']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, HrScheduleController)).toBe(
      'admin_hr',
    );
  });

  it('setSchedule has handler-level PermissionsAny(manage_schedule) overriding class for that route', () => {
    const handler = (HrScheduleController.prototype as any).setSchedule;
    expect(handler).toBeDefined();
    const metadata = Reflect.getMetadata(PERMISSIONS_ANY_KEY, handler);
    expect(metadata).toEqual(['manage_schedule']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it('getSchedule and getHistory inherit class permissions (no handler override)', () => {
    const getSchedule = (HrScheduleController.prototype as any).getSchedule;
    const getHistory = (HrScheduleController.prototype as any).getHistory;
    expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, getSchedule)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, getHistory)).toBeUndefined();
  });
});