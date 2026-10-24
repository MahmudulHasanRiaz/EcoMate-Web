import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
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

  /** Discount V2: total units of in-scope lines required (null = none). */
  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;

  /** Discount V2: sale lines never match and never count to thresholds. */
  @IsOptional()
  @IsBoolean()
  excludeSaleItems?: boolean;

  /** Discount V2: cap on the rule's total discount per order (null = none). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  /** Discount V2: false = rule does not apply when a coupon code is used. */
  @IsOptional()
  @IsBoolean()
  combineWithCoupon?: boolean;

  /** Discount V2: total redemptions across all orders (null = unlimited). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  /** Discount V2: redemptions per customer (null = unlimited). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  /** Discount V2: only customers with no prior non-trashed order. */
  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;

  /** Discount V2: higher wins when several rules match a line. */
  @IsOptional()
  @IsInt()
  priority?: number;

  /** Discount V2: narrows PRODUCT scope to these variants (empty = all). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variantIds?: string[];

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
  @IsInt()
  @Min(1)
  minQuantity?: number;

  @IsOptional()
  @IsBoolean()
  excludeSaleItems?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsBoolean()
  combineWithCoupon?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variantIds?: string[];

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

  /** Discount V2: narrows PRODUCT-scope rules with variantIds. The service
   * only trusts it when the variant exists AND belongs to productId. */
  @IsOptional()
  @IsString()
  variantId?: string;

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

  /** Discount V2: when set, rules with combineWithCoupon=false are skipped
   * (mirrors order creation, where the coupon code suppresses them). */
  @IsOptional()
  @IsString()
  couponCode?: string;
}
