import { PartialType } from '@nestjs/mapped-types';
import { CreateAttendanceDeviceDto } from './create-attendance-device.dto';

/**
 * Update payload. Credentials are deliberately absent (create-only) and
 * syncStatus is never client-settable — the service strips both defensively.
 */
export class UpdateAttendanceDeviceDto extends PartialType(
  CreateAttendanceDeviceDto,
) {}