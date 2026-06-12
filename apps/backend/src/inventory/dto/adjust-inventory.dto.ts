import { IsString, IsInt, IsOptional, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AdjustInventoryDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  comboId?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  reason: string;
}

export class BulkAdjustInventoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustInventoryDto)
  items: AdjustInventoryDto[];
}
