import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
  Min,
} from 'class-validator';
import { DeductionType } from '@prisma/client';

export class CreateDeductionDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(DeductionType)
  type: DeductionType;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsDateString()
  applicableFrom?: string;

  @IsOptional()
  @IsDateString()
  applicableTo?: string;
}

export class ApproveLedgerDto {}
