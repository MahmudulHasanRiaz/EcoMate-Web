import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  IsDateString,
} from 'class-validator';

export class StartTaskTimerDto {
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PauseTaskTimerDto {
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResumeTaskTimerDto {
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class StopTaskTimerDto {
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  markDone?: boolean;
}

export class LogTaskTimeDto {
  @IsString()
  employeeId: string;

  @IsNumber()
  @Min(1)
  durationMinutes: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}

export class TaskProductivityQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  page?: string | number;

  @IsOptional()
  perPage?: string | number;
}
