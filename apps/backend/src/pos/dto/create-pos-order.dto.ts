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
import { SalesChannel } from '@prisma/client';

export class PosOrderItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() comboId?: string;
  @IsOptional() @IsObject() comboSelection?: Record<string, string>;
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
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsEnum(SalesChannel) salesChannel?: SalesChannel;
  @IsOptional() @IsString() notes?: string;
}
