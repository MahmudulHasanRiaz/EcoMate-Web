import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Matches,
  Max,
  Min,
  MaxLength,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

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

export class RotationDayAssignmentDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsOptional()
  @IsString()
  shiftPresetId?: string | null;
}

export class BulkSetRotationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RotationDayAssignmentDto)
  // Bounded: each entry is one DB round-trip inside the transaction.
  @ArrayMaxSize(7)
  rotations: RotationDayAssignmentDto[];
}

/**
 * Clearing one weekday's shift. Separate from SetShiftRotationDto because the
 * set endpoint requires a preset while clearing must not send one — sharing the
 * DTO made `@IsString()` reject every "No shift" selection with a 400.
 */
export class ClearShiftRotationDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;
}

export class QuickAssignPresetDto {
  @IsString()
  shiftPresetId: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];
}

export class FindOrCreateCustomPresetDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime: string;

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
  @IsString()
  name?: string;
}