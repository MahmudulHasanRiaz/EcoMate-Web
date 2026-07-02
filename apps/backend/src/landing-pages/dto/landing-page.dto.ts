import {
  IsString,
  IsOptional,
  IsArray,
  IsObject,
  IsBoolean,
  IsIn,
} from 'class-validator';

export class CreateLandingPageDto {
  @IsString()
  title!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsIn(['template', 'custom'])
  pageType?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsArray()
  sections?: any[];

  @IsOptional()
  @IsString()
  customHtml?: string;

  @IsOptional()
  @IsString()
  customCss?: string;

  @IsOptional()
  @IsArray()
  productIds?: string[];

  @IsOptional()
  @IsArray()
  comboIds?: string[];

  @IsOptional()
  @IsObject()
  trackingJson?: Record<string, any>;
}

export class UpdateLandingPageDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsIn(['template', 'custom'])
  pageType?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsArray()
  sections?: any[];

  @IsOptional()
  @IsString()
  customHtml?: string;

  @IsOptional()
  @IsString()
  customCss?: string;

  @IsOptional()
  @IsArray()
  productIds?: string[];

  @IsOptional()
  @IsArray()
  comboIds?: string[];

  @IsOptional()
  @IsObject()
  trackingJson?: Record<string, any>;
}
