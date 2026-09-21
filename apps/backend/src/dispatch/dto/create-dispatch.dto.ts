import { IsString, IsOptional, IsArray, IsNumber, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductMappingItem {
  @IsString()
  productVariantId: string;
  @IsString()
  @IsOptional()
  productName?: string;
  @IsString()
  @IsOptional()
  variantName?: string;
  quantity: any;
}

export class CreateDispatchDto {
  @IsString()
  orderId: string;
  @IsString()
  courier: string;
  @IsString()
  consignmentId: string;
  @IsOptional()
  @IsString()
  trackingCode?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductMappingItem)
  productMapping?: ProductMappingItem[];
  @IsOptional()
  @IsString()
  notes?: string;
  /**
   * Staff-provided fulfillment cost at dispatch time (BDT, P2 §3.4). Fills a
   * missing Order.shippingCost as 'manual'; never overwrites an existing
   * manual cost. Courier auto-fill from a per-courier default is deferred
   * (no rate source exists) — see DispatchService.maybeRecordShippingCost.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;
}
