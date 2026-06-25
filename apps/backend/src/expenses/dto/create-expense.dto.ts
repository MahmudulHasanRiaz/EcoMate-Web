import { IsString, IsNotEmpty, IsOptional, IsNumber, IsPositive, IsDate, IsDefined, IsUrl, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateExpenseDto {
  @Transform(({ value }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @Type(() => Date)
  @IsDefined()
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
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  receiptUrl?: string;
}
