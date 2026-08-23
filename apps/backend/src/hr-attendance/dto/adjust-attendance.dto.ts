import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export const ADJUST_FIELDS = [
  'status',
  'workedMinutes',
  'breakMinutes',
  'checkInAt',
  'checkOutAt',
  'startedAt',
  'endedAt',
] as const;

export class AdjustAttendanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsIn(ADJUST_FIELDS)
  field: string;

  @IsOptional()
  @IsString()
  originalValue?: string;

  @IsString()
  @IsNotEmpty()
  correctedValue: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  dayId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  breakId?: string;
}