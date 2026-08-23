import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
} from 'class-validator';
import { CommissionAmountType } from '@prisma/client';

export class CreateCommissionRuleDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsOptional()
  @IsString()
  triggerStatusId?: string;

  @IsEnum(CommissionAmountType)
  amountType: CommissionAmountType;

  @IsNumber()
  @Min(0)
  amount: number;

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
