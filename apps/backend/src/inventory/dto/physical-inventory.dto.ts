import { IsString, IsInt, IsOptional, IsNumber, Min, Max, IsArray, ValidateNested } from 'class-validator';
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

  @IsOptional()
  @IsString()
  binLocationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitCost?: number;
}

export class BulkAdjustPhysicalItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(-999999)
  @Max(999999)
  @Type(() => Number)
  quantity: number;

  @IsOptional()
  @IsString()
  binLocationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitCost?: number;
}

export class BulkAdjustPhysicalDto {
  @IsString()
  warehouseId: string;

  @IsString()
  reason: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkAdjustPhysicalItemDto)
  items: BulkAdjustPhysicalItemDto[];
}