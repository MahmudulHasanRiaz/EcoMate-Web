import {
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  IsIn,
  IsBoolean,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class GrnItemDto {
  @IsString()
  purchaseItemId: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNumber()
  @Min(0)
  receivedQty: number;

  @IsNumber()
  @Min(0)
  acceptedQty: number;

  @IsNumber()
  @Min(0)
  rejectedQty: number;

  /**
   * Who bears damage cost when rejectedQty > 0. 'supplier' (damage excluded
   * from inventory value) or 'company' (damage cost allocated onto the
   * accepted units). Defaults to 'supplier'.
   */
  @IsOptional()
  @IsIn(['supplier', 'company'])
  damageResponsibility?: 'supplier' | 'company';

  /** Supplier-sent free replacement: accepted into stock at zero cost. */
  @IsOptional()
  @IsBoolean()
  freeOfCharge?: boolean;

  /** Per-line receiving location; falls back to the GRN warehouse. */
  @IsOptional()
  @IsString()
  lineWarehouseId?: string;
}

export class CreateGrnDto {
  @IsString()
  warehouseId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrnItemDto)
  items: GrnItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
