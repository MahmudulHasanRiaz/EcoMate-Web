import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Matches,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateShiftPresetDto {
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  name: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9_]{2,32}$/, {
    message: 'code must be 2-32 characters of A-Z, 0-9 or underscore',
  })
  code: string;

  /** Dhaka wall clock "HH:mm". */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime: string;

  /** Dhaka wall clock "HH:mm". */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime: string;

  @IsInt()
  @Min(0)
  @Max(120)
  graceMinutes: number;

  @IsInt()
  @Min(0)
  @Max(240)
  breakMinutes: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateShiftPresetDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  graceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  breakMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** One weekday's shift. Omitting a day clears it. */
export class SetShiftRotationDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  shiftPresetId: string;
}