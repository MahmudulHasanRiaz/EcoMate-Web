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
 * A line coming BACK on the original order (PARTIAL only). No price — the
 * return leg carries quantities, never money.
 */
export class ExchangeReturnItemDto {
  @IsString() productId: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) quantity: number;
}

/**
 * Create an Exchange Order against an existing order.
 *
 * The item list is a FULL new-order cart: the exchange is a replacement sale,
 * not a return (requirements §2). Customer and shipping are copied from the
 * original, but every financial figure here is new — nothing is inherited.
 */
export class CreateExchangeOrderDto {
  /**
   * Task 4 (Fix 8): the Full/Partial ask comes FIRST.
   * - FULL (default): the whole original comes back — the Return(EXCHANGE)
   *   record carries the full order snapshot.
   * - PARTIAL: staff picks `returningItems` — exchange order + Return(EXCHANGE)
   *   with those items are created at once (TWO records, ONE new Order).
   */
  @IsOptional() @IsIn(['FULL', 'PARTIAL'])
  mode?: 'FULL' | 'PARTIAL';

  /**
   * PARTIAL only: the original-order lines coming back. Required when
   * mode=PARTIAL, ignored when mode=FULL.
   */
  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExchangeReturnItemDto)
  returningItems?: ExchangeReturnItemDto[];

  /** Optional note stored on the Return(EXCHANGE) record. */
  @IsOptional() @IsString() @MaxLength(500)
  returnReason?: string;

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