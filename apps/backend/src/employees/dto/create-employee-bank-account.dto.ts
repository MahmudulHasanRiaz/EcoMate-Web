import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BankAccountType } from '@prisma/client';

// Nested bank account captured at employee creation (G-15). accountName is
// optional here — the backend defaults it to the better-auth user's name when
// absent (the DB column is NOT NULL).
export class CreateEmployeeBankAccountDto {
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

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
}
