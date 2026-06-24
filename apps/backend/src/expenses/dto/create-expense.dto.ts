import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum, IsDate, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseCategory } from '@prisma/client';

export class CreateExpenseDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @Type(() => Date)
  @IsDate()
  expenseDate: Date;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;
}
