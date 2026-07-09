import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsArray,
  IsUUID,
  ValidateNested,
  ValidateIf,
  MinLength,
  IsObject,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VariantAttributeDto {
  @IsString() attributeValueId: string;
}

export class CreateVariantDto {
  @IsString() @MinLength(1) sku: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsInt() managedStockQuantity?: number;
  @IsOptional() @IsNumber() standardCost?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDto)
  attributeValues?: VariantAttributeDto[];
}

export class CreateProductDto {
  @IsString() @MinLength(1) name: string;
  @IsString() @MinLength(1) slug: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() shortDesc?: string;
  @IsNumber() basePrice: number;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsInt() managedStockQuantity?: number;
  @IsOptional()
  @IsIn([
    'ALWAYS_IN_STOCK',
    'ALWAYS_OUT_OF_STOCK',
    'MANAGED_STOCK',
    'INVENTORY_CONTROLLED',
  ])
  availabilityMode?: string;
  @IsOptional() @IsNumber() standardCost?: number;
  @IsOptional() @IsInt() lowStockQty?: number;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsObject() seoMeta?: any;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() manageStock?: boolean;
  @IsOptional() @IsUUID() sizeChartId?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() shortDesc?: string;
  @IsOptional() @IsNumber() basePrice?: number;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsInt() managedStockQuantity?: number;
  @IsOptional()
  @IsIn([
    'ALWAYS_IN_STOCK',
    'ALWAYS_OUT_OF_STOCK',
    'MANAGED_STOCK',
    'INVENTORY_CONTROLLED',
  ])
  availabilityMode?: string;
  @IsOptional() @IsNumber() standardCost?: number;
  @IsOptional() @IsInt() lowStockQty?: number;
  @IsOptional()
  @ValidateIf((o) => o.categoryId !== null)
  @IsString()
  categoryId?: string | null;
  @IsOptional() @ValidateIf((o) => o.brandId !== null) @IsString() brandId?:
    | string
    | null;
  @IsOptional() @IsArray() @IsString({ each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsObject() seoMeta?: any;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() manageStock?: boolean;
  @IsOptional() @IsUUID() sizeChartId?: string | null;
}

export class GenerateVariantsDto {
  @IsArray() @IsString({ each: true }) attributeIds: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attributeValueIds?: string[];
  @IsOptional() @IsNumber() defaultPrice?: number;
  @IsOptional() @IsNumber() defaultSalePrice?: number;
  @IsOptional() @IsInt() defaultManagedStockQuantity?: number;
  @IsOptional() @IsNumber() defaultStandardCost?: number;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsInt() managedStockQuantity?: number;
  @IsOptional() @IsNumber() standardCost?: number;
  @IsOptional() @IsString() image?: string | null;
}
