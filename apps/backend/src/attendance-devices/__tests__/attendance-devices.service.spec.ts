import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AttendanceDevicesService } from '../attendance-devices.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption';
import { HrAttendanceService } from '../../hr-attendance/hr-attendance.service';
import * as net from 'net';

jest.mock('net', () => ({ Socket: jest.fn() }));

const MockSocket = net.Socket as unknown as jest.Mock;

type SocketState = {
  on: jest.Mock;
  once: jest.Mock;
  destroy: jest.Mock;
  connect: jest.Mock;
  setTimeout: jest.Mock;
};

const makeSocketStub = () => {
  const handlers: Record<string, (arg?: any) => void> = {};
  const stub: SocketState = {
    on: jest.fn().mockImplementation((ev: string, fn: any) => {
      handlers[ev] = fn;
    }),
    once: jest.fn().mockImplementation((ev: string, fn: any) => {
      handlers[`once:${ev}`] = fn;
    }),
    destroy: jest.fn(),
    connect: jest.fn(),
    setTimeout: jest.fn(),
  };
  return { stub, handlers };
};

describe('AttendanceDevicesService', () => {
  let service: AttendanceDevicesService;
  let prisma: any;
  let encryption: any;
  let hrAttendance: any;

  const TS = Date.parse('2026-08-24T09:00:00.000Z');

  const DEVICE = {
    id: 'dev-1',
    name: 'zk-teco',
    deviceType: 'BIOMETRIC',
    vendor: 'ZKTeco',
    identifier: null,
    location: 'Reception',
    connectionMethod: 'API',
    host: '192.168.1.10',
    port: 4370,
    enabled: false,
    syncStatus: 'IDLE',
    lastSyncAt: null,
    lastSyncError: null,
    credentialsEncrypted: 'enc:secret',
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const EMPLOYEE = {
    id: 'emp-1',
    employeeId: 'EMP-001',
    attendanceMethod: 'MACHINE',
  };

  beforeEach(async () => {
    prisma = {
      attendanceDevice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      employee: { findUnique: jest.fn() },
      deviceEmployeeMapping: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      rawAttendanceEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    encryption = { encrypt: jest.fn((p: string) => `enc:${p}`) };
    hrAttendance = {
      ingestMachineEvent: jest.fn().mockResolvedValue({ dayId: 'day-1' }),
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AttendanceDevicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: HrAttendanceService, useValue: hrAttendance },
      ],
    }).compile();
    service = module.get(AttendanceDevicesService);
    MockSocket.mockReset();
  });

  const stubSocket = (behavior: 'connect' | 'error' | 'timeout') => {
    const { stub, handlers } = makeSocketStub();
    MockSocket.mockImplementation(() => stub as any);
    if (behavior === 'connect') {
      setTimeout(() => handlers['once:connect']?.(), 0);
    } else if (behavior === 'error') {
      setTimeout(() => handlers['once:error']?.(new Error('ECONNREFUSED')), 0);
    } else {
      setTimeout(() => handlers['once:timeout']?.(), 0);
    }
    return stub;
  };

  describe('createDevice', () => {
    it('encrypts credentials and omits credentialsEncrypted from the response', async () => {
      prisma.attendanceDevice.create.mockResolvedValue({ ...DEVICE });
      const res = await service.createDevice(
        {
          name: 'zk-teco',
          deviceType: 'BIOMETRIC',
          host: '192.168.1.10',
          port: 4370,
          credentialsEncrypted: 'plain:secret',
        },
        'user-1',
      );
      expect(encryption.encrypt).toHaveBeenCalledWith('plain:secret');
      expect(
        prisma.attendanceDevice.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            credentialsEncrypted: 'enc:plain:secret',
            createdById: 'user-1',
            syncStatus: 'IDLE',
          }),
        }),
      );
      expect(res).not.toHaveProperty('credentialsEncrypted');
    });

    it('creates without touching syncStatus (saved device stays IDLE)', async () => {
      prisma.attendanceDevice.create.mockResolvedValue({ ...DEVICE });
      const res = await service.createDevice({ name: 'd', deviceType: 'x' }, 'user-1');
      const data = prisma.attendanceDevice.create.mock.calls[0][0].data;
      expect(data.syncStatus).toBe('IDLE');
      expect(res.syncStatus).toBe('IDLE');
    });

    it('skips encryption when no credentials provided', async () => {
      prisma.attendanceDevice.create.mockResolvedValue({ ...DEVICE, credentialsEncrypted: null });
      await service.createDevice({ name: 'd', deviceType: 'x' }, 'user-1');
      expect(encryption.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('listDevices', () => {
    it('never selects credentialsEncrypted and includes mapping counts', async () => {
      prisma.attendanceDevice.findMany.mockResolvedValue([
        { ...DEVICE, _count: { mappings: 2 } },
      ]);
      const res = await service.listDevices();
      const args = prisma.attendanceDevice.findMany.mock.calls[0][0];
      expect(args.select.credentialsEncrypted).toBeUndefined();
      expect(args.select._count).toEqual({ select: { mappings: true } });
      expect(res[0].mappingCount).toBe(2);
      expect(res[0]).not.toHaveProperty('credentialsEncrypted');
    });
  });

  describe('updateDevice', () => {
    it('404s when the device does not exist', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(
        service.updateDevice('dev-x', { name: 'new' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.attendanceDevice.update).not.toHaveBeenCalled();
    });

    it('updates allowed fields and strips syncStatus/credentials from client input', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.attendanceDevice.update.mockResolvedValue({ ...DEVICE, name: 'new' });
      const res = await service.updateDevice('dev-1', {
        name: 'new',
        syncStatus: 'CONNECTED',
        credentialsEncrypted: 'x',
      } as any);
      const data = prisma.attendanceDevice.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ name: 'new' });
      expect(data).not.toHaveProperty('syncStatus');
      expect(data).not.toHaveProperty('credentialsEncrypted');
      expect(res).not.toHaveProperty('credentialsEncrypted');
    });
  });

  describe('deleteDevice', () => {
    it('404s when not found', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(service.deleteDevice('dev-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes an existing device', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.attendanceDevice.delete.mockResolvedValue(DEVICE);
      await service.deleteDevice('dev-1');
      expect(prisma.attendanceDevice.delete).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
      });
    });
  });

  describe('testConnection', () => {
    it('404s for unknown device', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(service.testConnection('dev-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400 when host/port are not configured', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue({
        ...DEVICE,
        host: null,
        port: null,
      });
      await expect(service.testConnection('dev-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.attendanceDevice.update).not.toHaveBeenCalled();
    });

    it('marks CONNECTED on successful TCP connect', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.attendanceDevice.update.mockResolvedValue({
        ...DEVICE,
        syncStatus: 'CONNECTED',
      });
      const socket = stubSocket('connect');
      const res = await service.testConnection('dev-1');
      expect(socket.connect).toHaveBeenCalledWith(4370, '192.168.1.10');
      expect(prisma.attendanceDevice.update).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
        data: { syncStatus: 'CONNECTED', lastSyncError: null },
      });
      expect(res).toMatchObject({ syncStatus: 'CONNECTED' });
      expect(socket.destroy).toHaveBeenCalled();
    });

    it('marks DISCONNECTED + lastSyncError on connect failure', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.attendanceDevice.update.mockResolvedValue({
        ...DEVICE,
        syncStatus: 'DISCONNECTED',
        lastSyncError: 'ECONNREFUSED',
      });
      stubSocket('error');
      const res = await service.testConnection('dev-1');
      expect(prisma.attendanceDevice.update).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
        data: {
          syncStatus: 'DISCONNECTED',
          lastSyncError: expect.stringContaining('ECONNREFUSED'),
        },
      });
      expect(res.syncStatus).toBe('DISCONNECTED');
      expect(res.error).toBeTruthy();
    });

    it('does not change the saved device when not found', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(service.testConnection('dev-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('syncDevice', () => {
    it('sets SYNCING then CONNECTED + lastSyncAt on success', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.attendanceDevice.update.mockResolvedValueOnce({
        ...DEVICE,
        syncStatus: 'SYNCING',
      });
      const stamp = new Date('2026-08-24T12:00:00.000Z');
      jest.spyOn(global.Date, 'now').mockReturnValue(stamp.getTime());
      prisma.attendanceDevice.update.mockResolvedValueOnce({
        ...DEVICE,
        syncStatus: 'CONNECTED',
        lastSyncAt: stamp,
      });
      stubSocket('connect');
      const res = await service.syncDevice('dev-1');
      expect(prisma.attendanceDevice.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'dev-1' },
        data: { syncStatus: 'SYNCING', lastSyncError: null },
      });
      expect(prisma.attendanceDevice.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'dev-1' },
        data: { syncStatus: 'CONNECTED', lastSyncAt: stamp },
      });
      expect(res).toMatchObject({ syncStatus: 'CONNECTED', lastSyncAt: stamp });
      (global.Date.now as jest.Mock).mockRestore();
    });

    it('sets FAILED + lastSyncError when probe fails', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.attendanceDevice.update.mockResolvedValueOnce({
        ...DEVICE,
        syncStatus: 'SYNCING',
      });
      prisma.attendanceDevice.update.mockResolvedValueOnce({
        ...DEVICE,
        syncStatus: 'FAILED',
        lastSyncError: 'timeout',
      });
      stubSocket('timeout');
      const res = await service.syncDevice('dev-1');
      expect(prisma.attendanceDevice.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'dev-1' },
        data: { syncStatus: 'FAILED', lastSyncError: expect.any(String) },
      });
      expect(res.syncStatus).toBe('FAILED');
    });
  });

  describe('mappings', () => {
    it('404 when device missing on list', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(service.listMappings('dev-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists mappings with employee + betterAuthUser name', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.deviceEmployeeMapping.findMany.mockResolvedValue([
        {
          id: 'm-1',
          deviceId: 'dev-1',
          employeeId: 'emp-1',
          deviceEmployeeId: 'DE-1',
          employee: {
            employeeId: 'EMP-001',
            betterAuthUser: { name: 'Riaz Ahmed' },
          },
        },
      ]);
      const res = await service.listMappings('dev-1');
      expect(prisma.deviceEmployeeMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: 'dev-1' },
          include: { employee: { select: expect.any(Object) } },
        }),
      );
      expect(res[0].employee.betterAuthUser.name).toBe('Riaz Ahmed');
    });

    it('creates a mapping (device need not be enabled)', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue({ ...DEVICE });
      prisma.employee.findUnique.mockResolvedValue(EMPLOYEE);
      prisma.deviceEmployeeMapping.create.mockResolvedValue({
        id: 'm-1',
        deviceId: 'dev-1',
        employeeId: 'emp-1',
        deviceEmployeeId: 'DE-1',
      });
      const res = await service.createMapping('dev-1', {
        employeeId: 'emp-1',
        deviceEmployeeId: 'DE-1',
      });
      expect(res.deviceEmployeeId).toBe('DE-1');
    });

    it('404 when the device is unknown', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(
        service.createMapping('dev-x', {
          employeeId: 'emp-1',
          deviceEmployeeId: 'DE-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when the employee is unknown', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.createMapping('dev-1', {
          employeeId: 'emp-x',
          deviceEmployeeId: 'DE-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 when the employee attendance method is NONE', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        attendanceMethod: 'NONE',
      });
      await expect(
        service.createMapping('dev-1', {
          employeeId: 'emp-1',
          deviceEmployeeId: 'DE-1',
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'NONE method employees cannot be mapped to devices.',
      });
    });

    it('409 friendly on duplicate deviceEmployeeId', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.employee.findUnique.mockResolvedValue(EMPLOYEE);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-existing',
      });
      await expect(
        service.createMapping('dev-1', {
          employeeId: 'emp-1',
          deviceEmployeeId: 'DE-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a concurrent P2002 create to a friendly 409', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.employee.findUnique.mockResolvedValue(EMPLOYEE);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['deviceId', 'employeeId'] },
      });
      await expect(
        service.createMapping('dev-1', {
          employeeId: 'emp-1',
          deviceEmployeeId: 'DE-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes a mapping scoped to the device', async () => {
      prisma.deviceEmployeeMapping.deleteMany.mockResolvedValue({ count: 1 });
      await service.deleteMapping('dev-1', 'm-1');
      expect(prisma.deviceEmployeeMapping.deleteMany).toHaveBeenCalledWith({
        where: { id: 'm-1', deviceId: 'dev-1' },
      });
    });

    it('404 when the mapping does not belong to the device', async () => {
      prisma.deviceEmployeeMapping.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteMapping('dev-1', 'm-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('ingestEvents', () => {
    const ts = TS;

    const expectRow = (status: string) =>
      expect.objectContaining({
        data: expect.objectContaining({
          deviceId: 'dev-1',
          deviceEmployeeId: 'DE-1',
          eventType: 'CHECK_IN',
          occurredAt: new Date(TS),
          idempotencyKey: `dev-1:DE-1:${TS}`,
          status,
        }),
      });

    it('parses CSV and ingests through the machine path', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-1',
        deviceEmployeeId: 'DE-1',
        employeeId: 'emp-1',
        employee: EMPLOYEE,
      });
      prisma.rawAttendanceEvent.create.mockResolvedValue({ id: 'r-1' });
      const csv = [
        'deviceEmployeeId,eventType,occurredAt',
        'DE-1,CHECK_IN,2026-08-24T09:00:00.000Z',
        'DE-1,CHECK_OUT,2026-08-24T18:00:00.000Z',
      ].join('\n');
      const res = await service.ingestEvents('dev-1', csv);
      expect(hrAttendance.ingestMachineEvent).toHaveBeenNthCalledWith(
        1,
        'emp-1',
        'dev-1',
        'CHECK_IN',
        new Date(TS),
      );
      expect(hrAttendance.ingestMachineEvent).toHaveBeenNthCalledWith(
        2,
        'emp-1',
        'dev-1',
        'CHECK_OUT',
        new Date('2026-08-24T18:00:00.000Z'),
      );
      expect(res).toMatchObject({
        total: 2,
        ingested: 2,
        duplicates: 0,
        unmapped: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it('parses a JSON event array', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-1',
        employeeId: 'emp-1',
        employee: EMPLOYEE,
      });
      prisma.rawAttendanceEvent.create.mockResolvedValue({ id: 'r-1' });
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'DE-1',
            eventType: 'PUNCH',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
        ],
      });
      expect(hrAttendance.ingestMachineEvent).toHaveBeenCalledWith(
        'emp-1',
        'dev-1',
        'PUNCH',
        new Date(TS),
      );
      expect(res.ingested).toBe(1);
    });

    it('skips events whose idempotency key already exists', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue({
        id: 'r-existing',
        idempotencyKey: `dev-1:DE-1:${TS}`,
      });
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'DE-1',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
        ],
      });
      expect(res.duplicates).toBe(1);
      expect(hrAttendance.ingestMachineEvent).not.toHaveBeenCalled();
      expect(prisma.rawAttendanceEvent.create).not.toHaveBeenCalled();
    });

    it('counts a concurrent P2002 on raw row create as duplicate', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-1',
        employeeId: 'emp-1',
        employee: EMPLOYEE,
      });
      prisma.rawAttendanceEvent.create.mockRejectedValue({ code: 'P2002' });
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'DE-1',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
        ],
      });
      expect(res.duplicates).toBe(1);
      expect(res.ingested).toBe(0);
    });

    it('parks unmapped device employee ids as UNMAPPED and continues', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue(null);
      prisma.rawAttendanceEvent.create.mockResolvedValue({ id: 'r-1' });
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'UNKNOWN-1',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
          {
            deviceEmployeeId: 'DE-2',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:01.000Z',
          },
        ],
      });
      expect(prisma.rawAttendanceEvent.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'UNMAPPED',
            deviceEmployeeId: 'UNKNOWN-1',
          }),
        }),
      );
      expect(res.unmapped).toBe(2);
      expect(hrAttendance.ingestMachineEvent).not.toHaveBeenCalled();
    });

    it('records SKIPPED for NONE-method employees without calling the service', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-1',
        employeeId: 'emp-1',
        employee: { ...EMPLOYEE, attendanceMethod: 'NONE' },
      });
      prisma.rawAttendanceEvent.create.mockResolvedValue({ id: 'r-1' });
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'DE-1',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
        ],
      });
      expect(prisma.rawAttendanceEvent.create).toHaveBeenCalledWith(
        expectRow('SKIPPED'),
      );
      expect(hrAttendance.ingestMachineEvent).not.toHaveBeenCalled();
      expect(res.skipped).toBe(1);
    });

    it('marks FAILED when the machine path throws a friendly business error', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-1',
        employeeId: 'emp-1',
        employee: EMPLOYEE,
      });
      prisma.rawAttendanceEvent.create.mockResolvedValue({ id: 'r-1' });
      hrAttendance.ingestMachineEvent.mockRejectedValue(
        new ConflictException('Machine attendance is disabled in APP mode.'),
      );
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'DE-1',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
        ],
      });
      expect(prisma.rawAttendanceEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            employeeId: 'emp-1',
            rawPayload: {
              error: 'Machine attendance is disabled in APP mode.',
            },
          }),
        }),
      );
      expect(res.failed).toBe(1);
    });

    it('marks FAILED when the machine path throws an unknown error', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      prisma.deviceEmployeeMapping.findUnique.mockResolvedValue({
        id: 'm-1',
        employeeId: 'emp-1',
        employee: EMPLOYEE,
      });
      prisma.rawAttendanceEvent.create.mockResolvedValue({ id: 'r-1' });
      hrAttendance.ingestMachineEvent.mockRejectedValue(new Error('boom'));
      const res = await service.ingestEvents('dev-1', {
        events: [
          {
            deviceEmployeeId: 'DE-1',
            eventType: 'CHECK_IN',
            occurredAt: '2026-08-24T09:00:00.000Z',
          },
        ],
      });
      expect(res.failed).toBe(1);
      expect(prisma.rawAttendanceEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('counts malformed CSV rows as failed', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findUnique.mockResolvedValue(null);
      const csv = [
        'deviceEmployeeId,eventType,occurredAt',
        'DE-1,CHECK_IN,2026-08-24T09:00:00.000Z',
        'DE-1,NOT_A_TYPE,2026-08-24T10:00:00.000Z',
        'garbage-line',
        '',
      ].join('\n');
      const res = await service.ingestEvents('dev-1', csv);
      expect(res.total).toBe(2);
      expect(res.failed).toBe(1);
    });

    it('404s when the device is unknown', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(null);
      await expect(service.ingestEvents('dev-x', 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listEvents', () => {
    it('returns the raw audit list with idempotencyKey and optional status filter', async () => {
      prisma.attendanceDevice.findUnique.mockResolvedValue(DEVICE);
      prisma.rawAttendanceEvent.findMany.mockResolvedValue([
        {
          id: 'r-1',
          idempotencyKey: `dev-1:DE-1:${TS}`,
          status: 'PROCESSED',
        },
      ]);
      prisma.rawAttendanceEvent.count.mockResolvedValue(1);
      const res = await service.listEvents('dev-1', 'PROCESSED', 2, 25);
      expect(prisma.rawAttendanceEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: 'dev-1', status: 'PROCESSED' },
          skip: 25,
          take: 25,
        }),
      );
      expect(res.items[0].idempotencyKey).toBe(`dev-1:DE-1:${TS}`);
      expect(res).toMatchObject({ total: 1, page: 2, perPage: 25 });
    });
  });
});