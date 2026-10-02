import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

const PURPOSES = ['Confirmed', 'Packed', 'Shipping', 'Delivered', 'Returned', 'Cancelled'];
const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];
const BASES = ['order_total', 'subtotal'];

export class CreateCommissionRuleV2Dto {
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  name?: string;

  // Restricted to the commissionable order statuses. The UI offers exactly
  // these, so a caller cannot invent an action that means nothing.
  @IsIn(PURPOSES, { message: `purpose must be one of: ${PURPOSES.join(', ')}` })
  purpose: string;

  @IsIn(['fixed', 'percent'])
  amountType: 'fixed' | 'percent';

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Commission amount must be greater than zero' })
  amount: number;

  @IsOptional()
  @IsIn(BASES)
  valueBasis?: string;

  /** Optional per-order amount gate. Distinct from the count threshold. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  capPerOrder?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  minimumCount?: number | null;

  @IsOptional()
  @IsIn(PERIODS)
  thresholdPeriod?: string | null;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCommissionRuleV2Dto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(PURPOSES) purpose?: string;
  @IsOptional() @IsIn(['fixed', 'percent']) amountType?: 'fixed' | 'percent';
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount?: number;
  @IsOptional() @IsIn(BASES) valueBasis?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minOrderAmount?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) capPerOrder?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() minimumCount?: number | null;
  @IsOptional() @IsIn(PERIODS) thresholdPeriod?: string | null;
  @IsOptional() @IsISO8601() effectiveFrom?: string | null;
  @IsOptional() @IsISO8601() effectiveTo?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SetRuleActiveDto {
  @IsBoolean()
  isActive: boolean;
}

export class PreviewRuleDto extends CreateCommissionRuleV2Dto {}

export class CommissionRangeQueryDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsISO8601({ strict: false }) from?: string;
  @IsOptional() @IsISO8601({ strict: false }) to?: string;
}

export class CommissionDrilldownQueryDto extends CommissionRangeQueryDto {
  @IsOptional()
  @IsIn(PURPOSES)
  purpose?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;
}