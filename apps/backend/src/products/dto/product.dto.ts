import { IsString, IsOptional, IsBoolean, IsInt, IsNumber, IsArray, ValidateNested, MinLength, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class VariantAttributeDto {
  @IsString() attributeValueId: string;
}

export class CreateVariantDto {
  @IsString() @MinLength(1) sku: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsInt() stock?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantAttributeDto)
  attributeValues?: VariantAttributeDto[];
}

export class CreateProductDto {
  @IsString() @MinLength(1) name: string;
  @IsString() @MinLength(1) slug: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() basePrice: number;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsObject() seoMeta?: any;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() basePrice?: number;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsObject() seoMeta?: any;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
