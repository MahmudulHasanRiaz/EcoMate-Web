import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { HrAttendanceController } from '../hr-attendance.controller';

describe('HrAttendanceController', () => {
  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrAttendanceController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });

  it('has class-level PermissionsAny(manage_attendance)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, HrAttendanceController),
    ).toEqual(['manage_attendance']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, HrAttendanceController),
    ).toBe('admin_hr');
  });

  describe('route wiring (static paths before :id)', () => {
    const pathOf = (proto: any, method: string) =>
      Reflect.getMetadata('path', proto[method]);

    it('POST /hr/attendance', () => {
      expect(pathOf(HrAttendanceController.prototype, 'createRecord')).toBe(
        'attendance',
      );
    });

    it('GET /hr/attendance', () => {
      expect(pathOf(HrAttendanceController.prototype, 'findAll')).toBe(
        'attendance',
      );
    });

    it('GET /hr/attendance/daily-overview', () => {
      expect(
        pathOf(HrAttendanceController.prototype, 'dailyOverview'),
      ).toBe('attendance/daily-overview');
    });

    it('GET /hr/attendance/history', () => {
      expect(pathOf(HrAttendanceController.prototype, 'history')).toBe(
        'attendance/history',
      );
    });

    it('GET /hr/attendance/:id', () => {
      expect(pathOf(HrAttendanceController.prototype, 'findOne')).toBe(
        'attendance/:id',
      );
    });

    it('PATCH /hr/attendance/:id', () => {
      expect(pathOf(HrAttendanceController.prototype, 'updateRecord')).toBe(
        'attendance/:id',
      );
    });
  });
});