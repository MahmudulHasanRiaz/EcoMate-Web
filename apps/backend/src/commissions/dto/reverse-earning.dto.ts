import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReverseEarningDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  refundedAmount?: number;
}
