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
  // Decorated so the global whitelist ValidationPipe does not strip it —
  // dispatch-level quantities drive remaining-fulfillment calculations.
  @IsNumber()
  @Min(0)
  quantity: number;
}

export class CreateDispatchDto {
  @IsString()
  orderId: string;
  @IsString()
  courier: string;
  // Optional: a manual row may be created before the courier booking exists.
  // The courier webhook backfills the identifiers on match (Task 4).
  @IsOptional()
  @IsString()
  consignmentId?: string;
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
