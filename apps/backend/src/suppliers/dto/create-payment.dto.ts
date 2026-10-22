import { IsNumber, IsString, IsOptional, IsDateString } from 'class-validator';

export class CreatePaymentDto {
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /** Part 5: eligible CoA asset leaf that paid the supplier. */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
