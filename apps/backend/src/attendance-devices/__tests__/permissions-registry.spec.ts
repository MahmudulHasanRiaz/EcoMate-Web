import {
  PERMISSIONS,
  getAllPermissions,
  getPermissionLabel,
} from '../../common/permissions/registry';

describe('permissions registry — attendance settings/devices/adjustments', () => {
  it('registers manage_hr_settings in the HR permission keys', () => {
    expect(PERMISSIONS.HR).toContain('manage_hr_settings');
  });

  it('registers manage_attendance_devices in the HR permission keys', () => {
    expect(PERMISSIONS.HR).toContain('manage_attendance_devices');
  });

  it('registers manage_attendance_adjustments in the HR permission keys', () => {
    expect(PERMISSIONS.HR).toContain('manage_attendance_adjustments');
  });

  it('exposes all three via getAllPermissions()', () => {
    const keys = getAllPermissions();
    expect(keys).toContain('manage_hr_settings');
    expect(keys).toContain('manage_attendance_devices');
    expect(keys).toContain('manage_attendance_adjustments');
  });

  it('provides human labels for all three', () => {
    expect(getPermissionLabel('manage_hr_settings')).toBe('Manage HR Settings');
    expect(getPermissionLabel('manage_attendance_devices')).toBe(
      'Manage Attendance Devices',
    );
    expect(getPermissionLabel('manage_attendance_adjustments')).toBe(
      'Manage Attendance Adjustments',
    );
  });
});