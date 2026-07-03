import {
  IsString, IsOptional, IsNumber, IsArray, ValidateNested,
  IsInt, Min, IsIn, ArrayMinSize, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PosOrderItemDto } from './create-pos-order.dto';

export class HoldCartDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];

  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;

  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsIn(['flat', 'percentage']) discountType?: string;
}
