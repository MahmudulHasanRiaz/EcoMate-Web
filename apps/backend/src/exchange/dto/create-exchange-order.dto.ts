import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExchangeItemDto {
  @IsString() productId: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() @Min(0) price: number;
}

/**
 * Create an Exchange Order against an existing order.
 *
 * The item list is a FULL new-order cart: the exchange is a replacement sale,
 * not a return (requirements §2). Customer and shipping are copied from the
 * original, but every financial figure here is new — nothing is inherited.
 */
export class CreateExchangeOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ExchangeItemDto)
  items!: ExchangeItemDto[];

  /** Fresh discount for the EXCHANGE only. The original is never rewritten. */
  @IsOptional() @IsNumber() @Min(0)
  discount?: number;

  @IsOptional() @IsIn(['flat', 'percentage'])
  discountType?: 'flat' | 'percentage';

  /** Fresh delivery charge. Defaults to 0 — nothing is copied (§2). */
  @IsOptional() @IsNumber() @Min(0)
  shippingCharge?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  customerNotes?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  officeNotes?: string;
}