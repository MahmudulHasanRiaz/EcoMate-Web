import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
  Min,
} from 'class-validator';
import { EarningType } from '@prisma/client';

export class CreateEarningDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(EarningType)
  type: EarningType;

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
