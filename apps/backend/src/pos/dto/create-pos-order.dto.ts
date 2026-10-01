import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsEnum,
  IsIn,
  ArrayMinSize,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesChannel, SalesChannelV2, AcquisitionType } from '@prisma/client';

export class PosOrderItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() comboId?: string;
  @IsOptional() @IsObject() comboSelection?: Record<string, string>;
  @IsOptional() @IsString() sourceWarehouseId?: string;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() price: number;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsIn(['flat', 'percentage']) discountType?: string;
}

export class PosPaymentDto {
  @IsString()
  method: string;

  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreatePosOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments?: PosPaymentDto[];

  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;

  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsIn(['flat', 'percentage']) discountType?: string;

  @IsOptional() @IsString() deliveryMethod?: string;
  /** Free-text delivery note. Kept as-is; not parsed into an address book row. */
  @IsOptional() @IsString() deliveryAddress?: string;
  /**
   * Structured order-owned address snapshots. POS capture only writes them
   * when supplied; they are never derived from `deliveryAddress`, which is
   * free text that cannot be reliably parsed into locality fields.
   */
  @IsOptional() @IsObject() shippingAddress?: any;
  @IsOptional() @IsObject() billingAddress?: any;
  // ── Canonical sales-attribution dimensions (all optional) ──
  // POS resolves its showroom entity from the session; the cashier never
  // selects it, and acquisition stays NULL because a POS sale is never
  // inferred to be organic.
  @IsOptional() @IsEnum(SalesChannelV2) channel?: SalesChannelV2;
  @IsOptional() @IsString() channelEntity?: string;
  @IsOptional() @IsString() sourceSlug?: string;
  @IsOptional() @IsEnum(AcquisitionType) acquisitionType?: AcquisitionType;
  @IsOptional() @IsEnum(SalesChannel) salesChannel?: SalesChannel;
  @IsOptional() @IsString() notes?: string;
}
