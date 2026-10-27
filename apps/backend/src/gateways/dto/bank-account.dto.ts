import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BankAccountType } from '@prisma/client';

// The shared BankAccountType enum also carries OTHERS (employee bank
// accounts). Merchant receiving accounts are SAVINGS/CURRENT only, per
// the NPSB requirement — hence IsIn, not IsEnum, on both DTOs.
const MERCHANT_ACCOUNT_TYPES = ['SAVINGS', 'CURRENT'] as const;

/**
 * One merchant receiving bank account for the Bank (manual) gateway.
 * Every field is a customer-facing NPSB payment instruction — the same
 * trust level as a manual gateway's phoneNumber, never a secret.
 * accountNumber / routingNumber stay strings: identifiers may carry
 * leading zeros and are never quantities.
 */
export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  accountHolderName!: string;

  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  branchName!: string;

  @IsString()
  @IsNotEmpty()
  routingNumber!: string;

  @IsIn(MERCHANT_ACCOUNT_TYPES)
  accountType!: BankAccountType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bankName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  branchName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  routingNumber?: string;

  @IsOptional()
  @IsIn(MERCHANT_ACCOUNT_TYPES)
  accountType?: BankAccountType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
