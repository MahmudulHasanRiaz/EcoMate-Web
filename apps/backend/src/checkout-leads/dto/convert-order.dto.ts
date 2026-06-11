import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsObject,
} from 'class-validator';

class ConvertItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() comboId?: string;
  @IsNumber() quantity: number;
  @IsNumber() price: number;
}

export class ConvertOrderDto {
  @IsOptional() @IsArray() items?: ConvertItemDto[];
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;
  @IsOptional() @IsObject() shippingAddress?: any;
  @IsOptional() @IsString() paymentMethod?: string;
}
