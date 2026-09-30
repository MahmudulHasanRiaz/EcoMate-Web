import {
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  IsBoolean,
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

  /**
   * Explicit acknowledgement for a deduction that would remove (nearly) all of
   * the item's available stock — mirrors the physical-inventory guard so one
   * mis-keyed entry cannot silently zero a managed position.
   */
  @IsOptional()
  @IsBoolean()
  confirmDestructive?: boolean;
}

export class BulkAdjustInventoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustInventoryDto)
  items: AdjustInventoryDto[];
}
