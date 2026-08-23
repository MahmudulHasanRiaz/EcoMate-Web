import { IsEnum } from 'class-validator';
import { AttendanceModeSetting } from '@prisma/client';

export class UpdateAttendanceSettingsDto {
  @IsEnum(AttendanceModeSetting, {
    message: 'mode must be one of APP, MACHINE, BOTH',
  })
  mode: AttendanceModeSetting;
}