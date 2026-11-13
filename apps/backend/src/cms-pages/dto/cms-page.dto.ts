import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsObject,
  IsIn,
  IsDateString,
  MinLength,
} from 'class-validator';

export class CreateCmsPageDto {
  @IsString()
  @MinLength(1)
  slug: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  showInFooter?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsIn(['content', 'template'])
  type?: string;

  @IsOptional()
  @IsString()
  templateKey?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  // SEO + document versioning (storefront dynamic-pages round).
  @IsOptional()
  @IsString()
  metaDescription?: string;

  @IsOptional()
  @IsString()
  ogImage?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class UpdateCmsPageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  showInFooter?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsIn(['content', 'template'])
  type?: string;

  @IsOptional()
  @IsString()
  templateKey?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  // SEO + document versioning (storefront dynamic-pages round).
  @IsOptional()
  @IsString()
  metaDescription?: string;

  @IsOptional()
  @IsString()
  ogImage?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}
