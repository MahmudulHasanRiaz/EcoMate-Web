import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BankAccountType, BankVerificationStatus } from '@prisma/client';

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsOptional()
  @IsEnum(BankAccountType)
  accountType?: BankAccountType;

  @IsOptional()
  @IsString()
  routingNumber?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsEnum(BankVerificationStatus)
  verificationStatus?: BankVerificationStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}