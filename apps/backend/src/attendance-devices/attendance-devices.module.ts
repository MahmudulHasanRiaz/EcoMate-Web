import {
  Injectable,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { EncryptionService } from '../common/utils/encryption';
import { HrAttendanceModule } from '../hr-attendance/hr-attendance.module';
import { AttendanceSettingsController } from './attendance-settings.controller';
import { AttendanceDevicesController } from './attendance-devices.controller';
import { AttendanceSettingsService } from './attendance-settings.service';
import { AttendanceDevicesService } from './attendance-devices.service';

/**
 * Fastify has no built-in text/csv parser — without one every CSV push would
 * 415 before reaching the controller. Registered here (module-scoped) so no
 * main.ts changes are needed.
 */
@Injectable()
export class CsvBodyParser implements OnModuleInit {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onModuleInit() {
    const instance = (this.httpAdapterHost.httpAdapter as any)?.getInstance?.();
    if (!instance) return;
    for (const contentType of ['text/csv', 'application/csv']) {
      if (instance.hasContentTypeParser(contentType)) continue;
      instance.addContentTypeParser(
        contentType,
        (_req: any, payload: any, done: (err: Error | null, body?: string) => void) => {
          const chunks: Buffer[] = [];
          payload.on('data', (chunk: Buffer) => chunks.push(chunk));
          payload.on('end', () =>
            done(null, Buffer.concat(chunks).toString('utf8')),
          );
          payload.on('error', (err: Error) => done(err));
        },
      );
    }
  }
}

@Module({
  imports: [PrismaModule, HrAttendanceModule],
  controllers: [AttendanceSettingsController, AttendanceDevicesController],
  providers: [
    AttendanceSettingsService,
    AttendanceDevicesService,
    EncryptionService,
    CsvBodyParser,
  ],
  exports: [AttendanceSettingsService, AttendanceDevicesService],
})
export class AttendanceDevicesModule {}