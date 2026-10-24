import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateDiscountDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsIn(['SITEWIDE', 'CATEGORY', 'PRODUCT'])
  scope!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @IsIn(['percentage', 'flat'])
  type!: string;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDiscountDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['SITEWIDE', 'CATEGORY', 'PRODUCT'])
  scope?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsIn(['percentage', 'flat'])
  type?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  // Nullable ON PURPOSE: sending endsAt: null reopens an ended campaign
  // (open-ended again). @IsOptional skips null, so null survives to the
  // service, which distinguishes undefined (untouched) from null (clear).
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class EvaluateItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  addonAmount?: number;
}

export class EvaluateDiscountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluateItemDto)
  items!: EvaluateItemDto[];
}
