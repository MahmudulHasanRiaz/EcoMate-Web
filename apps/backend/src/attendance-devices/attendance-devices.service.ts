import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as net from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';
import { HrAttendanceService } from '../hr-attendance/hr-attendance.service';
import { CreateAttendanceDeviceDto } from './dto/create-attendance-device.dto';
import { CreateDeviceMappingDto } from './dto/create-device-mapping.dto';

type DeviceWhereUniqueInput = Prisma.AttendanceDeviceWhereUniqueInput;

const DEVICE_SAFE_SELECT = {
  id: true,
  name: true,
  deviceType: true,
  vendor: true,
  identifier: true,
  location: true,
  connectionMethod: true,
  host: true,
  port: true,
  enabled: true,
  syncStatus: true,
  lastSyncAt: true,
  lastSyncError: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AttendanceDeviceSelect;

const EVENT_TYPES = ['CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'PUNCH'];

const CSV_HEADER = 'deviceEmployeeId,eventType,occurredAt';

type ParsedEvent = {
  deviceEmployeeId: string;
  eventType: string;
  occurredAt: Date;
  occurredAtMs: number;
};

type IngestCounters = {
  total: number;
  ingested: number;
  duplicates: number;
  unmapped: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class AttendanceDevicesService {
  private readonly probeTimeoutMs = 3000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly hrAttendance: HrAttendanceService,
  ) {}

  async listDevices() {
    const devices = await this.prisma.attendanceDevice.findMany({
      select: {
        ...DEVICE_SAFE_SELECT,
        _count: { select: { mappings: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const deviceIds = (devices as any[]).map((d) => d.id);

    // G-13: batch-unmapped counts in a single query
    const unmappedCounts = deviceIds.length
      ? await this.prisma.rawAttendanceEvent.groupBy({
          by: ['deviceId'],
          where: { deviceId: { in: deviceIds }, status: 'UNMAPPED' as any },
          _count: { id: true },
        })
      : [];

    const countMap = new Map<string, number>();
    for (const row of unmappedCounts) {
      if (row.deviceId) countMap.set(row.deviceId, row._count.id);
    }

    return (devices as Array<
        Record<string, unknown> & { credentialsEncrypted?: unknown; _count: { mappings: number } }
      >).map(
        ({ _count, credentialsEncrypted: _omit, ...device }) => ({
          ...device,
          mappingCount: _count.mappings,
          unmappedEventCount: countMap.get((device as any).id) ?? 0,
        }),
      );
  }

  async createDevice(dto: CreateAttendanceDeviceDto, actorId?: string) {
    const data: Prisma.AttendanceDeviceCreateInput = {
      name: dto.name,
      deviceType: dto.deviceType,
      vendor: dto.vendor,
      identifier: dto.identifier,
      location: dto.location,
      connectionMethod: dto.connectionMethod ?? 'API',
      host: dto.host,
      port: dto.port,
      enabled: dto.enabled,
      syncStatus: 'IDLE',
      createdById: actorId,
    };
    if (dto.credentialsEncrypted) {
      data.credentialsEncrypted = this.encryption.encrypt(
        dto.credentialsEncrypted,
      );
    }
    const created = await this.prisma.attendanceDevice.create({ data });
    const { credentialsEncrypted: _omit, ...safe } = created as any;
    return safe;
  }

  async updateDevice(id: string, dto: Record<string, any>) {
    const existing = await this.prisma.attendanceDevice.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Attendance device not found');
    }
    const { syncStatus: _omitStatus, credentialsEncrypted: _omitCreds, ...rest } =
      dto as any;
    const updated = await this.prisma.attendanceDevice.update({
      where: { id },
      data: rest,
    });
    const { credentialsEncrypted: _omit, ...safe } = updated as any;
    return safe;
  }

  async deleteDevice(id: string) {
    const existing = await this.prisma.attendanceDevice.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Attendance device not found');
    }
    return this.prisma.attendanceDevice.delete({ where: { id } });
  }

  async testConnection(id: string) {
    const device = await this.requireDevice(id);
    if (!device.host || !device.port) {
      throw new BadRequestException(
        'Device must have host and port configured before testing the connection.',
      );
    }
    try {
      await this.probeTcp(device.host, device.port);
    } catch (err: any) {
      const error = err?.message ?? 'Connection failed';
      await this.prisma.attendanceDevice.update({
        where: { id },
        data: { syncStatus: 'DISCONNECTED', lastSyncError: error },
      });
      return { syncStatus: 'DISCONNECTED', error };
    }
    await this.prisma.attendanceDevice.update({
      where: { id },
      data: { syncStatus: 'CONNECTED', lastSyncError: null },
    });
    return { syncStatus: 'CONNECTED', lastSyncAt: device.lastSyncAt };
  }

  async syncDevice(id: string) {
    const device = await this.requireDevice(id);
    if (!device.host || !device.port) {
      throw new BadRequestException(
        'Device must have host and port configured before syncing.',
      );
    }
    await this.prisma.attendanceDevice.update({
      where: { id },
      data: { syncStatus: 'SYNCING', lastSyncError: null },
    });
    try {
      await this.probeTcp(device.host, device.port);
    } catch (err: any) {
      const error = err?.message ?? 'Connection failed';
      await this.prisma.attendanceDevice.update({
        where: { id },
        data: { syncStatus: 'FAILED', lastSyncError: error },
      });
      return { syncStatus: 'FAILED', error };
    }
    const lastSyncAt = new Date(Date.now());
    await this.prisma.attendanceDevice.update({
      where: { id },
      data: { syncStatus: 'CONNECTED', lastSyncAt },
    });
    return { syncStatus: 'CONNECTED', lastSyncAt };
  }

  async listMappings(deviceId: string) {
    await this.requireDevice(deviceId);
    return this.prisma.deviceEmployeeMapping.findMany({
      where: { deviceId },
      include: {
        employee: {
          select: { employeeId: true, betterAuthUser: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMapping(deviceId: string, dto: CreateDeviceMappingDto) {
    await this.requireDevice(deviceId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, attendanceMethod: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    if (employee.attendanceMethod === 'NONE') {
      throw new BadRequestException(
        'NONE method employees cannot be mapped to devices.',
      );
    }
    const byDeviceEmployee = await this.prisma.deviceEmployeeMapping.findUnique({
      where: {
        deviceId_deviceEmployeeId: {
          deviceId,
          deviceEmployeeId: dto.deviceEmployeeId,
        },
      },
    });
    if (byDeviceEmployee) {
      throw new ConflictException(
        'This device employee ID is already mapped to an employee.',
      );
    }
    const byEmployee = await this.prisma.deviceEmployeeMapping.findUnique({
      where: {
        deviceId_employeeId: { deviceId, employeeId: dto.employeeId },
      },
    });
    if (byEmployee) {
      throw new ConflictException(
        'This employee is already mapped to this device.',
      );
    }
    try {
      return await this.prisma.deviceEmployeeMapping.create({
        data: {
          deviceId,
          employeeId: dto.employeeId,
          deviceEmployeeId: dto.deviceEmployeeId,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A mapping with the same device employee ID or employee already exists for this device.',
        );
      }
      throw err;
    }
  }

  async deleteMapping(deviceId: string, mappingId: string) {
    const res = await this.prisma.deviceEmployeeMapping.deleteMany({
      where: { id: mappingId, deviceId },
    });
    if (res.count === 0) {
      throw new NotFoundException('Device mapping not found');
    }
    return { deleted: true };
  }

  async ingestEvents(deviceId: string, body: { events?: any[] } | string) {
    await this.requireDevice(deviceId);
    const { events, malformed } = this.parseEvents(body);
    const counters: IngestCounters = {
      total: events.length + malformed,
      ingested: 0,
      duplicates: 0,
      unmapped: 0,
      skipped: 0,
      failed: malformed,
    };
    for (const event of events) {
      const idempotencyKey = this.idempotencyKey(deviceId, event);
      const existing = await this.prisma.rawAttendanceEvent.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        counters.duplicates += 1;
        continue;
      }
      const mapping = await this.prisma.deviceEmployeeMapping.findUnique({
        where: {
          deviceId_deviceEmployeeId: { deviceId, deviceEmployeeId: event.deviceEmployeeId },
        },
        select: { employeeId: true, employee: { select: { attendanceMethod: true } } },
      });
      if (!mapping) {
        const parked = await this.persistRaw(
          event,
          deviceId,
          idempotencyKey,
          'UNMAPPED',
        );
        if (!parked) {
          counters.duplicates += 1;
          continue;
        }
        counters.unmapped += 1;
        continue;
      }
      if (mapping.employee.attendanceMethod === 'NONE') {
        const parked = await this.persistRaw(
          event,
          deviceId,
          idempotencyKey,
          'SKIPPED',
          mapping.employeeId,
        );
        if (!parked) {
          counters.duplicates += 1;
          continue;
        }
        counters.skipped += 1;
        continue;
      }
      try {
        await this.hrAttendance.ingestMachineEvent(
          mapping.employeeId,
          deviceId,
          event.eventType as any,
          event.occurredAt,
        );
      } catch (err: any) {
        const message =
          err instanceof Error ? err.message : 'Unknown ingestion error';
        const parked = await this.persistRaw(
          event,
          deviceId,
          idempotencyKey,
          'FAILED',
          mapping.employeeId,
          { error: message },
        );
        if (!parked) {
          counters.duplicates += 1;
          continue;
        }
        counters.failed += 1;
        continue;
      }
      const parked = await this.persistRaw(
        event,
        deviceId,
        idempotencyKey,
        'PROCESSED',
        mapping.employeeId,
      );
      if (!parked) {
        counters.duplicates += 1;
        continue;
      }
      counters.ingested += 1;
    }
    return counters;
  }

  async listEvents(
    deviceId: string,
    status?: string,
    page = 1,
    perPage = 50,
  ) {
    await this.requireDevice(deviceId);
    const safePerPage = Math.min(Math.max(perPage, 1), 100);
    const safePage = Math.max(page, 1);
    const where: Prisma.RawAttendanceEventWhereInput = { deviceId };
    if (status) where.status = status as any;
    const [items, total] = await Promise.all([
      this.prisma.rawAttendanceEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (safePage - 1) * safePerPage,
        take: safePerPage,
      }),
      this.prisma.rawAttendanceEvent.count({ where }),
    ]);
    return { items, total, page: safePage, perPage: safePerPage };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async requireDevice(id: string) {
    const device = await this.prisma.attendanceDevice.findUnique({
      where: { id },
    });
    if (!device) {
      throw new NotFoundException('Attendance device not found');
    }
    return device;
  }

  private probeTcp(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(this.probeTimeoutMs);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () =>
        fail(new Error(`Connection timed out after ${this.probeTimeoutMs}ms`)),
      );
      socket.once('error', (err) => fail(err));
      socket.connect(port, host);
    });
  }

  private idempotencyKey(deviceId: string, event: ParsedEvent) {
    return `${deviceId}:${event.deviceEmployeeId}:${event.occurredAtMs}`;
  }

  private parseEvents(
    body: { events?: any[] } | string,
  ): { events: ParsedEvent[]; malformed: number } {
    if (typeof body === 'string') {
      return this.parseCsv(body);
    }
    if (!Array.isArray(body?.events)) {
      throw new BadRequestException(
        'Expected JSON body { events: [...] } or CSV text.',
      );
    }
    const events: ParsedEvent[] = [];
    let malformed = 0;
    for (const raw of body.events) {
      const event = this.parseSingleEvent(raw);
      if (event) events.push(event);
      else malformed += 1;
    }
    return { events, malformed };
  }

  private parseCsv(text: string): { events: ParsedEvent[]; malformed: number } {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines.length === 0 || lines[0]?.trim() !== CSV_HEADER) {
      throw new BadRequestException(
        `CSV must start with header: ${CSV_HEADER}`,
      );
    }
    const events: ParsedEvent[] = [];
    let malformed = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(',');
      if (cols.length < 3) continue;
      const event = this.parseSingleEvent({
        deviceEmployeeId: cols[0],
        eventType: cols[1],
        occurredAt: cols[2],
      });
      if (event) events.push(event);
      else malformed += 1;
    }
    return { events, malformed };
  }

  private parseSingleEvent(raw: any): ParsedEvent | null {
    const occurredAtMs = Date.parse(raw?.occurredAt);
    if (
      !raw?.deviceEmployeeId ||
      typeof raw.deviceEmployeeId !== 'string' ||
      !EVENT_TYPES.includes(raw?.eventType) ||
      !Number.isFinite(occurredAtMs)
    ) {
      return null;
    }
    return {
      deviceEmployeeId: raw.deviceEmployeeId,
      eventType: raw.eventType,
      occurredAt: new Date(occurredAtMs),
      occurredAtMs,
    };
  }

  private async persistRaw(
    event: ParsedEvent,
    deviceId: string,
    idempotencyKey: string,
    status: 'UNMAPPED' | 'SKIPPED' | 'PROCESSED' | 'FAILED',
    employeeId?: string,
    rawPayload?: Record<string, unknown>,
  ) {
    try {
      return await this.prisma.rawAttendanceEvent.create({
        data: {
          deviceId,
          deviceEmployeeId: event.deviceEmployeeId,
          employeeId,
          eventType: event.eventType as any,
          occurredAt: event.occurredAt,
          rawPayload: rawPayload as Prisma.InputJsonValue | undefined,
          idempotencyKey,
          status,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return null;
      throw err;
    }
  }
}