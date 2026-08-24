import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateBankAccountDto } from './create-bank-account.dto';

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {
  // Free-text note recorded with a verification status change (G-16).
  @IsOptional()
  @IsString()
  verificationNote?: string;
}
