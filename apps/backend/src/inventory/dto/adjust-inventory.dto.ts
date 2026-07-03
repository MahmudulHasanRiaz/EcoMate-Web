import {
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
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
  @Min(-999999)
  @Max(999999)
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
