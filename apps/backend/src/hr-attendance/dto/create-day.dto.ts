import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export const MANUAL_DAY_STATUSES = ['ABSENT', 'ON_LEAVE', 'WEEKLY_OFF'] as const;

export class CreateAttendanceDayDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsDateString()
  date: string;

  @IsIn(MANUAL_DAY_STATUSES)
  status: 'ABSENT' | 'ON_LEAVE' | 'WEEKLY_OFF';

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  note?: string;
}
