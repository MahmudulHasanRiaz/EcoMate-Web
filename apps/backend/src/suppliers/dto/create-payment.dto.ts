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

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
