import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsArray,
  ValidateNested,
  MinLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateComboItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  quantity: number;

  @IsOptional()
  @IsNumber()
  price?: number;
}

export class CreateComboDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  shortDesc?: string;

  @IsNumber()
  basePrice: number;

  @IsOptional()
  @IsNumber()
  salePrice?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsObject()
  seoMeta?: any;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateComboItemDto)
  items: CreateComboItemDto[];
}

export class UpdateComboItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  quantity: number;

  @IsOptional()
  @IsNumber()
  price?: number;
}

export class UpdateComboDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  shortDesc?: string;

  @IsOptional()
  @IsNumber()
  basePrice?: number;

  @IsOptional()
  @IsNumber()
  salePrice?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsObject()
  seoMeta?: any;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateComboItemDto)
  items?: UpdateComboItemDto[];
}
