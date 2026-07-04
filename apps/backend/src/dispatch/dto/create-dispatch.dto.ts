import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
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
}
