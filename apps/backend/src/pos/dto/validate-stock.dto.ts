import { IsString, IsOptional, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ValidateStockItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) quantity: number;
}

export class ValidateStockDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidateStockItemDto)
  items: ValidateStockItemDto[];
}

export class AlternativeSourceDto {
  warehouseId: string;
  warehouseName: string;
  warehouseType: string;
  stock: number;
  reserved: number;
  available: number;
}

export class StockValidationItemResult {
  productId?: string;
  variantId?: string;
  requested: number;
  available: boolean;
  currentStock: number;
  currentAvailable: number;
  alternatives: AlternativeSourceDto[];
}

export class StockValidationResult {
  allAvailable: boolean;
  items: StockValidationItemResult[];
}