import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  payslipId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
