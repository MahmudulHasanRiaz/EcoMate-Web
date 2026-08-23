import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { HrSelfServiceController } from '../hr-self-service.controller';

describe('HrSelfServiceController', () => {
  it('is employee-scoped', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrSelfServiceController)).toEqual([
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
  });
});