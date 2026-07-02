import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsObject,
  IsIn,
  IsEnum,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentStatus } from '@prisma/client';

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
  @IsOptional() @IsString() couponCode?: string;

  // Checkout enhancements
  @IsOptional()
  @IsIn(['FULL_PAYMENT', 'PARTIAL_PAYMENT', 'CASH_ON_DELIVERY'])
  paymentOptionType?: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY';
  @IsOptional() @IsString() gatewayCode?: string;
  @IsOptional() @IsNumber() partialAmount?: number;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() thana?: string;
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
}

export class VerifyPaymentDto {
  @IsEnum(PaymentStatus) status: PaymentStatus;
  @IsOptional() @IsString() notes?: string;
}

export class CancelOrderDto {
  @IsString() token: string;
}
