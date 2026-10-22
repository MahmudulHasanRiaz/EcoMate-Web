import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsObject,
  IsIn,
  IsEnum,
} from 'class-validator';
import { SalesChannelV2, AcquisitionType } from '@prisma/client';

class ConvertItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() comboId?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsNumber() quantity: number;
  @IsNumber() price: number;
}

export class ConvertOrderDto {
  @IsOptional() @IsArray() items?: ConvertItemDto[];
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;
  @IsOptional() @IsObject() shippingAddress?: any;
  /**
   * Order-owned historical billing snapshot, independent from shippingAddress.
   * Never derived from the shipping address.
   */
  @IsOptional() @IsObject() billingAddress?: any;
  // ── Canonical sales-attribution dimensions (all optional; an order is never
  // rejected because an attribution field was omitted) ──
  @IsOptional() @IsEnum(SalesChannelV2) channel?: SalesChannelV2;
  @IsOptional() @IsString() channelEntity?: string;
  @IsOptional() @IsString() sourceSlug?: string;
  @IsOptional() @IsEnum(AcquisitionType) acquisitionType?: AcquisitionType;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsNumber() shippingCharge?: number;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsString() @IsIn(['flat', 'percentage']) discountType?: string;
  @IsOptional() @IsString() customerNotes?: string;
  @IsOptional() @IsString() officeNotes?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() thana?: string;
  @IsOptional() @IsString() paymentMode?: string;
  @IsOptional() @IsNumber() partialAmount?: number;
  @IsOptional() @IsString() salesChannel?: string;
  @IsOptional() @IsString() sourcePlatform?: string;
  @IsOptional() @IsString() sourceType?: string;
  @IsOptional() @IsString() sourceEntity?: string;
}
