import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AttendanceSettingsController } from '../attendance-settings.controller';
import { AttendanceSettingsService } from '../attendance-settings.service';
import { Test } from '@nestjs/testing';

describe('AttendanceSettingsController', () => {
  let controller: AttendanceSettingsController;
  const service = { getSettings: jest.fn(), updateSettings: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AttendanceSettingsController],
      providers: [
        { provide: AttendanceSettingsService, useValue: service },
      ],
    }).compile();
    controller = module.get(AttendanceSettingsController);
  });

  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AttendanceSettingsController)).toEqual(
      ['superadmin', 'admin', 'manager'],
    );
  });

  it('has class-level PermissionsAny(manage_attendance, manage_hr_settings)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, AttendanceSettingsController),
    ).toEqual(['manage_attendance', 'manage_hr_settings']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, AttendanceSettingsController),
    ).toBe('admin_hr');
  });

  it('GET attendance/settings → current mode row', async () => {
    service.getSettings.mockResolvedValue({ id: 'global', mode: 'MACHINE' });
    const res = await controller.get();
    expect(service.getSettings).toHaveBeenCalled();
    expect(res.mode).toBe('MACHINE');
  });

  it('GET route path + method are wired', () => {
    const proto = AttendanceSettingsController.prototype as any;
    expect(Reflect.getMetadata('path', proto.get)).toBe('attendance/settings');
    expect(Reflect.getMetadata('method', proto.get)).toBe(0);
  });

  it('PATCH attendance/settings overrides permission to manage_hr_settings', () => {
    const proto = AttendanceSettingsController.prototype as any;
    expect(Reflect.getMetadata('path', proto.update)).toBe('attendance/settings');
    expect(Reflect.getMetadata('method', proto.update)).toBe(4);
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, proto.update),
    ).toEqual(['manage_hr_settings']);
  });

  it('PATCH records updatedById from the auth user', async () => {
    service.updateSettings.mockResolvedValue({
      id: 'global',
      mode: 'BOTH',
      updatedById: 'user-9',
    });
    const res = await controller.update({ mode: 'BOTH' }, {
      userId: 'user-9',
    });
    expect(service.updateSettings).toHaveBeenCalledWith('BOTH', 'user-9');
    expect(res.updatedById).toBe('user-9');
  });

  it('falls back to user.id when userId is absent', async () => {
    service.updateSettings.mockResolvedValue({});
    await controller.update({ mode: 'APP' }, { id: 'user-2' });
    expect(service.updateSettings).toHaveBeenCalledWith('APP', 'user-2');
  });
});