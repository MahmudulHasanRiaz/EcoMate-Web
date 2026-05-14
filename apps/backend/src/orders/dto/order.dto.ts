import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsInt, Min, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsString() productId: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() price: number;
}

export class CreateOrderDto {
  @IsString() customerId: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto) items: OrderItemDto[];
  @IsOptional() @IsNumber() shippingCharge?: number;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsObject() shippingAddress?: any;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateOrderStatusDto {
  @IsString() statusId: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreatePaymentDto {
  @IsString() method: string;
  @IsNumber() amount: number;
  @IsOptional() @IsString() transactionId?: string;
  @IsOptional() @IsString() screenshot?: string;
  @IsOptional() @IsString() notes?: string;
}

export class VerifyPaymentDto {
  @IsString() status: string;
  @IsOptional() @IsString() notes?: string;
}
