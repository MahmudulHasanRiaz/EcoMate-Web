import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsInt,
  IsBoolean,
  Min,
  IsObject,
  IsIn,
  IsEnum,
  IsEmail,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentStatus, SalesChannel, SalesChannelV2, AcquisitionType } from '@prisma/client';

export class OrderItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() comboId?: string;
  @IsOptional() @IsObject() comboSelection?: Record<string, string>;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() price: number;
}

export class CreateOrderDto {
  @IsOptional() @IsString() customerId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
  @IsOptional() @IsNumber() shippingCharge?: number;
  @IsOptional() @IsString() selectedShippingOptionId?: string;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsIn(['flat', 'percentage']) discountType?: string;
  @IsOptional() @IsObject() shippingAddress?: any;
  /**
   * Order-owned historical billing snapshot. Stored ONLY when actually supplied
   * at checkout; absent stays empty and is never derived from shippingAddress.
   */
  @IsOptional() @IsObject() billingAddress?: any;
  @IsOptional() @IsString() customerNotes?: string;
  @IsOptional() @IsString() officeNotes?: string;
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;
  /**
   * Optional second contact number for the customer (staff-entered). Stored
   * on the order and linked to the customer via CustomerPhone — never matched
   * implicitly. A number owned by another customer is refused (409).
   */
  @IsOptional() @IsString() secondaryPhone?: string;
  @IsOptional() @IsEmail() guestEmail?: string;
  @IsOptional() @IsString() couponCode?: string;
  /** Actual fulfillment/courier cost (BDT). Absent = not recorded (NULL). */
  @IsOptional() @IsNumber() @Min(0) shippingCost?: number;
  /** 'manual' (staff-entered, actual) | 'courier_default' (estimated). */
  @IsOptional() @IsIn(['manual', 'courier_default']) shippingCostSource?: string;

  // Checkout enhancements
  @IsOptional()
  @IsIn(['FULL_PAYMENT', 'PARTIAL_PAYMENT', 'CASH_ON_DELIVERY'])
  paymentOptionType?: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY';
  @IsOptional() @IsString() gatewayCode?: string;
  @IsOptional() @IsNumber() partialAmount?: number;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() thana?: string;
  @IsOptional()
  @IsEnum(SalesChannel)
  salesChannel?: SalesChannel;
  @IsOptional() @IsString() sourcePlatform?: string;
  @IsOptional() @IsString() sourceType?: string;
  @IsOptional() @IsString() sourceEntity?: string;
  // ── Canonical sales-attribution dimensions ──────────────────────────────
  // Four INDEPENDENT facts; none implies another. All optional — an order is
  // never rejected because an attribution field was omitted. Compatibility
  // with the channel is validated in SalesChannelService, which clears an
  // incompatible source and reports a warning rather than refusing the order.
  @IsOptional() @IsEnum(SalesChannelV2) channel?: SalesChannelV2;
  @IsOptional() @IsString() channelEntity?: string;
  @IsOptional() @IsString() sourceSlug?: string;
  @IsOptional() @IsEnum(AcquisitionType) acquisitionType?: AcquisitionType;
  /** Raw landing signals (utm/click-id/referrer) collected first-party by the storefront. */
  @IsOptional() @IsObject() attribution?: Record<string, unknown>;
  /**
   * First-party device/technical context (screen, viewport, timezone, language,
   * platform, browser, OS, device type). Analytics input, frozen into the
   * order's attribution snapshot; free-form object, never trusted for logic.
   */
  @IsOptional() @IsObject() device?: Record<string, unknown>;
  @IsOptional() @IsString() trackingSessionId?: string;
}

export class UpdateOrderStatusDto {
  @IsString() statusId: string;
  @IsOptional() @IsString() note?: string;
}

export class CustomerInfoDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  /**
   * Optional second contact number (staff-entered). Same link/refuse rules
   * as order creation: stored on the order snapshot and linked via
   * CustomerPhone, refused when owned by another customer.
   */
  @IsOptional()
  @IsString()
  secondaryPhone?: string | null;

  @IsOptional()
  @IsString()
  email?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsNumber() shippingCharge?: number;
  @IsOptional() @IsString() selectedShippingOptionId?: string;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsIn(['flat', 'percentage']) discountType?: string;
  @IsOptional() @IsObject() shippingAddress?: any;
  /**
   * Order-owned historical billing snapshot. Independent from shippingAddress:
   * supplying one never clears or derives the other, and omitting it leaves the
   * stored value exactly as it was. Never back-filled from shippingAddress.
   */
  @IsOptional() @IsObject() billingAddress?: any;
  @IsOptional() @IsString() customerNotes?: string;
  @IsOptional() @IsString() officeNotes?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerInfoDto)
  customerInfo?: CustomerInfoDto;
  /**
   * Opt-in to also correcting the CANONICAL customer profile.
   *
   * Default false: an order correction updates the order's own snapshot only.
   * The profile is customer-owned and changes through explicit profile-edit
   * flows — a single order edit must never silently rewrite a real person's
   * identity. When true, only explicitly supplied fields are written.
   */
  @IsOptional() @IsBoolean() updateCustomerProfile?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];
  // Payment editing — mirrors the create-page payment UI so staff can switch
  // an order between COD / full online payment / partial payment and choose
  // the gateway the customer should use.
  @IsOptional()
  @IsIn(['FULL_PAYMENT', 'PARTIAL_PAYMENT', 'CASH_ON_DELIVERY'])
  paymentOptionType?: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY';
  @IsOptional() @IsString() gatewayCode?: string;
  @IsOptional() @IsNumber() partialAmount?: number;
  /** Actual fulfillment/courier cost (BDT). Absent = not recorded (NULL). */
  @IsOptional() @IsNumber() @Min(0) shippingCost?: number;
  /** 'manual' (staff-entered, actual) | 'courier_default' (estimated). */
  @IsOptional() @IsIn(['manual', 'courier_default']) shippingCostSource?: string;
}

export class UpdateOrderItemDto {
  @IsString() productId: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() price: number;
}

export class CreatePaymentDto {
  @IsString() gatewayCode: string;
  @IsNumber() amount: number;
  @IsOptional() @IsString() transactionId?: string;
  @IsOptional() @IsString() screenshot?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() token?: string;
}

export class VerifyPaymentDto {
  @IsEnum(PaymentStatus) status: PaymentStatus;
  @IsOptional() @IsString() notes?: string;
  /** Gateway/processing fee for THIS payment row (BDT). Absent = not recorded. */
  @IsOptional() @IsNumber() @Min(0) feeAmount?: number;
}

/**
 * POST /orders/:id/verify-payment body. Same wire shape as the previous
 * loose @Body('…') params ({ verified, note, feeAmount }) — now validated:
 * feeAmount is @IsNumber (rejects NaN/Infinity by default) + @Min(0), so a
 * non-finite or negative fee is a 400 before reaching the service (which
 * keeps its own `!(feeAmount >= 0)` guard as defense in depth).
 */
export class VerifyOrderPaymentDto {
  @IsBoolean() verified: boolean;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsNumber() @Min(0) feeAmount?: number;
}

export class CancelOrderDto {
  @IsString() token: string;
}
