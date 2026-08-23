import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { CommissionAmountType } from '@prisma/client';

export class UpdateCommissionRuleDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  triggerStatusId?: string;

  @IsOptional()
  @IsEnum(CommissionAmountType)
  amountType?: CommissionAmountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  valueBasis?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capPerOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetCommissionRuleActiveDto {
  @IsBoolean()
  isActive: boolean;
}
