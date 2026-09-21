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
import { PaymentStatus, SalesChannel } from '@prisma/client';

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
  @IsOptional() @IsString() customerNotes?: string;
  @IsOptional() @IsString() officeNotes?: string;
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;
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
  /** Raw landing signals (utm/click-id/referrer) collected first-party by the storefront. */
  @IsOptional() @IsObject() attribution?: Record<string, unknown>;
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
  @IsOptional() @IsString() customerNotes?: string;
  @IsOptional() @IsString() officeNotes?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerInfoDto)
  customerInfo?: CustomerInfoDto;
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
