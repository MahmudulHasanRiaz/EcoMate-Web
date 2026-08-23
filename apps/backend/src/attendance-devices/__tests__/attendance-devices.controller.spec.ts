import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_ANY_KEY,
} from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AttendanceDevicesController } from '../attendance-devices.controller';
import { AttendanceDevicesService } from '../attendance-devices.service';
import { Test } from '@nestjs/testing';

describe('AttendanceDevicesController', () => {
  let controller: AttendanceDevicesController;
  const service = {
    listDevices: jest.fn(),
    createDevice: jest.fn(),
    updateDevice: jest.fn(),
    deleteDevice: jest.fn(),
    testConnection: jest.fn(),
    syncDevice: jest.fn(),
    listMappings: jest.fn(),
    createMapping: jest.fn(),
    deleteMapping: jest.fn(),
    ingestEvents: jest.fn(),
    listEvents: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AttendanceDevicesController],
      providers: [
        { provide: AttendanceDevicesService, useValue: service },
      ],
    }).compile();
    controller = module.get(AttendanceDevicesController);
  });

  it('has class-level Roles(superadmin, admin, manager) metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AttendanceDevicesController)).toEqual([
      'superadmin',
      'admin',
      'manager',
    ]);
  });

  it('has class-level PermissionsAny(manage_attendance_devices)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, AttendanceDevicesController),
    ).toEqual(['manage_attendance_devices']);
  });

  it('has class-level RequiresFeature(admin_hr) metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, AttendanceDevicesController),
    ).toBe('admin_hr');
  });

  const pathOf = (method: string) =>
    Reflect.getMetadata(
      'path',
      (AttendanceDevicesController.prototype as any)[method],
    );
  const methodOf = (method: string) =>
    Reflect.getMetadata(
      'method',
      (AttendanceDevicesController.prototype as any)[method],
    );

  it('wires device CRUD routes', () => {
    expect(pathOf('list')).toBe('attendance/devices');
    expect(methodOf('list')).toBe(0);
    expect(pathOf('create')).toBe('attendance/devices');
    expect(methodOf('create')).toBe(1);
    expect(pathOf('update')).toBe('attendance/devices/:id');
    expect(methodOf('update')).toBe(4);
    expect(pathOf('remove')).toBe('attendance/devices/:id');
    expect(methodOf('remove')).toBe(3);
  });

  it('wires test/sync routes as POST', () => {
    expect(pathOf('test')).toBe('attendance/devices/:id/test');
    expect(methodOf('test')).toBe(1);
    expect(pathOf('sync')).toBe('attendance/devices/:id/sync');
    expect(methodOf('sync')).toBe(1);
  });

  it('wires mapping routes', () => {
    expect(pathOf('listMappings')).toBe('attendance/devices/:id/mappings');
    expect(methodOf('listMappings')).toBe(0);
    expect(pathOf('createMapping')).toBe('attendance/devices/:id/mappings');
    expect(methodOf('createMapping')).toBe(1);
    expect(pathOf('deleteMapping')).toBe(
      'attendance/devices/:id/mappings/:mappingId',
    );
    expect(methodOf('deleteMapping')).toBe(3);
  });

  it('wires the events ingestion + audit routes', () => {
    expect(pathOf('ingest')).toBe('attendance/devices/:id/events');
    expect(methodOf('ingest')).toBe(1);
    expect(pathOf('listEvents')).toBe('attendance/devices/:id/events');
    expect(methodOf('listEvents')).toBe(0);
  });

  it('create passes the actor id to the service', async () => {
    service.createDevice.mockResolvedValue({ id: 'dev-1' });
    const dto = { name: 'd', deviceType: 'x' };
    await controller.create(dto, { userId: 'user-1' });
    expect(service.createDevice).toHaveBeenCalledWith(dto, 'user-1');
  });

  it('update delegates with id + dto', async () => {
    service.updateDevice.mockResolvedValue({ id: 'dev-1' });
    await controller.update('dev-1', { name: 'new' });
    expect(service.updateDevice).toHaveBeenCalledWith('dev-1', { name: 'new' });
  });

  it('test/sync delegate with the device id', async () => {
    service.testConnection.mockResolvedValue({ syncStatus: 'CONNECTED' });
    service.syncDevice.mockResolvedValue({ syncStatus: 'FAILED' });
    await controller.test('dev-1');
    await controller.sync('dev-1');
    expect(service.testConnection).toHaveBeenCalledWith('dev-1');
    expect(service.syncDevice).toHaveBeenCalledWith('dev-1');
  });

  it('ingest passes the raw body through to the service', async () => {
    service.ingestEvents.mockResolvedValue({
      total: 1,
      ingested: 1,
      duplicates: 0,
      unmapped: 0,
      skipped: 0,
      failed: 0,
    });
    const body = {
      events: [{ deviceEmployeeId: 'DE-1', eventType: 'CHECK_IN', occurredAt: 'x' }],
    };
    await controller.ingest('dev-1', body);
    expect(service.ingestEvents).toHaveBeenCalledWith('dev-1', body);
  });

  it('listEvents passes status + pagination queries', async () => {
    service.listEvents.mockResolvedValue({ items: [], total: 0, page: 1, perPage: 50 });
    await controller.listEvents('dev-1', 'FAILED', 2, 25);
    expect(service.listEvents).toHaveBeenCalledWith('dev-1', 'FAILED', 2, 25);
  });
});