import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { HrSelfServiceController } from '../hr-self-service.controller';

describe('HrSelfServiceController', () => {
  it('is scoped to any authenticated staff role (ownership enforced via resolveEmployee → 404 for staff without an Employee record)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrSelfServiceController)).toEqual([
      'superadmin',
      'admin',
      'manager',
      'cashier',
      'employee',
    ]);
  });

  describe('self attendance routes', () => {
    const pathOf = (method: string) =>
      Reflect.getMetadata('path', HrSelfServiceController.prototype[method]);
    const methodOf = (method: string) =>
      Reflect.getMetadata('method', HrSelfServiceController.prototype[method]);

    it('exposes check-in / break start / break end / check-out posts', () => {
      expect(pathOf('checkInSelf')).toBe('attendance/check-in');
      expect(pathOf('breakStartSelf')).toBe('attendance/break/start');
      expect(pathOf('breakEndSelf')).toBe('attendance/break/end');
      expect(pathOf('checkOutSelf')).toBe('attendance/check-out');
      expect(methodOf('checkInSelf')).toBe(1);
      expect(methodOf('checkOutSelf')).toBe(1);
    });

    it('exposes today state + keeps the history list', () => {
      expect(pathOf('getTodayAttendance')).toBe('attendance/today');
      expect(methodOf('getTodayAttendance')).toBe(0);
      expect(pathOf('getAttendance')).toBe('attendance');
    });

    it('exposes the self attendance report over /hr/my/attendance/report', () => {
      expect(pathOf('getAttendanceReport')).toBe('attendance/report');
      expect(methodOf('getAttendanceReport')).toBe(0);
    });
  });

  describe('self leave balances route', () => {
    it('exposes GET leave-balances', () => {
      const pathOf = (method: string) =>
        Reflect.getMetadata('path', HrSelfServiceController.prototype[method]);
      const methodOf = (method: string) =>
        Reflect.getMetadata('method', HrSelfServiceController.prototype[method]);
      expect(pathOf('getLeaveBalances')).toBe('leave-balances');
      expect(methodOf('getLeaveBalances')).toBe(0);
    });
  });
});