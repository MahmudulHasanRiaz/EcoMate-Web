import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReturnOrderItemDto {
  @IsUUID()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateReturnOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReturnOrderItemDto)
  items!: ReturnOrderItemDto[];

  /**
   * ONE overall reason for the whole return (requirements §2: no per-item
   * reasons). Stored on the RTN as officeNotes and written to both timelines.
   */
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  /**
   * Financial adjustment of the ORIGINAL order, applied only to the original.
   *
   * These are FINAL VALUES, not deltas, and they default to the original's
   * current values — so omitting them preserves today's behaviour exactly.
   *
   * The Return Order itself never carries these: it holds product line amount
   * only (shippingCharge 0, discount 0). That is what keeps the money in
   * exactly one place and prevents double counting (requirements §3, §6).
   */
  @IsOptional() @IsNumber() @Min(0)
  adjustOriginalDiscount?: number;

  @IsOptional() @IsIn(['flat', 'percentage'])
  adjustOriginalDiscountType?: 'flat' | 'percentage';

  @IsOptional() @IsNumber() @Min(0)
  adjustOriginalShippingCharge?: number;

  /**
   * Requirements §5: after the split, ask whether the REMAINING original
   * quantity is delivered.
   *   true  (default) → original Partial → Delivered immediately (legacy path)
   *   false           → original stays Partial and continues its courier
   *                     lifecycle; the webhook decides the final status.
   */
  @IsOptional() @IsBoolean()
  deliverRemainingImmediately?: boolean;
}