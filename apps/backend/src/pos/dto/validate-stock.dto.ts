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
  /**
   * Why the item cannot be sold, when the block comes from the product's
   * availabilityMode rather than a quantity shortfall (e.g. an
   * INVENTORY_CONTROLLED product while Inventory Management is off, or an
   * ALWAYS_OUT_OF_STOCK product). Lets the till explain instead of showing
   * a bare "out of stock".
   */
  reason?: string;
}

export class StockValidationResult {
  allAvailable: boolean;
  items: StockValidationItemResult[];
}