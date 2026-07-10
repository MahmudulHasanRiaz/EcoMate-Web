import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AdjustPhysicalDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  warehouseId: string;

  @IsInt()
  @Min(-999999)
  @Max(999999)
  @Type(() => Number)
  quantity: number;

  @IsString()
  reason: string;
}