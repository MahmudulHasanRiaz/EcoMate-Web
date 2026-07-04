import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsObject,
  IsIn,
} from 'class-validator';

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
  @IsOptional() @IsString() paymentMethod?: string;
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
}
