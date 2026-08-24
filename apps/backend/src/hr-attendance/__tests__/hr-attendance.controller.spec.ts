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

  describe('route wiring', () => {
    const pathOf = (proto: any, method: string) =>
      Reflect.getMetadata('path', proto[method]);
    const methodOf = (proto: any, method: string) =>
      Reflect.getMetadata('method', proto[method]);
    // Nest stores the HTTP method as the numeric RequestMethod enum (POST=1, GET=0).

    it('walks today state transition handlers', () => {
      expect(pathOf(HrAttendanceController.prototype, 'checkIn')).toBe(
        'attendance/check-in',
      );
      expect(methodOf(HrAttendanceController.prototype, 'checkIn')).toBe(1);
      expect(pathOf(HrAttendanceController.prototype, 'breakStart')).toBe(
        'attendance/break/start',
      );
      expect(pathOf(HrAttendanceController.prototype, 'breakEnd')).toBe(
        'attendance/break/end',
      );
      expect(pathOf(HrAttendanceController.prototype, 'checkOut')).toBe(
        'attendance/check-out',
      );
      expect(methodOf(HrAttendanceController.prototype, 'checkOut')).toBe(1);
    });

    it('GET /hr/attendance/today provides the UI state', () => {
      expect(pathOf(HrAttendanceController.prototype, 'dayState')).toBe(
        'attendance/today',
      );
      expect(methodOf(HrAttendanceController.prototype, 'dayState')).toBe(0);
    });

    it('preserves the legacy list/overview/history contracts', () => {
      expect(pathOf(HrAttendanceController.prototype, 'findAll')).toBe(
        'attendance',
      );
      expect(
        pathOf(HrAttendanceController.prototype, 'dailyOverview'),
      ).toBe('attendance/daily-overview');
      expect(pathOf(HrAttendanceController.prototype, 'history')).toBe(
        'attendance/history',
      );
    });

    it('lists adjustments', () => {
      expect(pathOf(HrAttendanceController.prototype, 'listAdjustments')).toBe(
        'attendance/adjustments',
      );
      expect(methodOf(HrAttendanceController.prototype, 'listAdjustments')).toBe(
        0,
      );
    });

    it('POST /hr/attendance/adjustments overrides the class permission with the dedicated key', () => {
      expect(pathOf(HrAttendanceController.prototype, 'createAdjustment')).toBe(
        'attendance/adjustments',
      );
      expect(methodOf(HrAttendanceController.prototype, 'createAdjustment')).toBe(
        1,
      );
      expect(
        Reflect.getMetadata(
          PERMISSIONS_ANY_KEY,
          HrAttendanceController.prototype.createAdjustment,
        ),
      ).toEqual(['manage_attendance_adjustments']);
    });

    it('removes the old manual record create/update endpoints', () => {
      const proto = HrAttendanceController.prototype as any;
      expect(proto.createRecord).toBeUndefined();
      expect(proto.updateRecord).toBeUndefined();
      expect(proto.findOne).toBeUndefined();
    });

    it('POST /hr/attendance/days records a manual absence day with the adjustments permission', () => {
      const proto = HrAttendanceController.prototype as any;
      expect(proto.createDay).toBeDefined();
      expect(pathOf(HrAttendanceController.prototype, 'createDay')).toBe(
        'attendance/days',
      );
      expect(methodOf(HrAttendanceController.prototype, 'createDay')).toBe(1);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_ANY_KEY,
          HrAttendanceController.prototype.createDay,
        ),
      ).toEqual(['manage_attendance_adjustments']);
    });

    it('POST /hr/attendance/close-session closes open sessions with the adjustments permission', () => {
      const proto = HrAttendanceController.prototype as any;
      expect(proto.closeSession).toBeDefined();
      expect(pathOf(HrAttendanceController.prototype, 'closeSession')).toBe(
        'attendance/close-session',
      );
      expect(methodOf(HrAttendanceController.prototype, 'closeSession')).toBe(1);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_ANY_KEY,
          HrAttendanceController.prototype.closeSession,
        ),
      ).toEqual(['manage_attendance_adjustments']);
    });

    it('GET /hr/attendance/report exposes the derived attendance report', () => {
      expect(pathOf(HrAttendanceController.prototype, 'report')).toBe(
        'attendance/report',
      );
      expect(methodOf(HrAttendanceController.prototype, 'report')).toBe(0);
    });
  });
});