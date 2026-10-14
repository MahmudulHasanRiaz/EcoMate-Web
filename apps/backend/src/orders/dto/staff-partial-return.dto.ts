import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StaffPartialReturnItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * Task 5 (Fix 9, owner-locked Rule 15): staff-partial creation.
 *
 * Button 'Create Partial Return Order' on Shipping AND Partial orders →
 * creates Return(PARTIAL, items=marked products) → order → Partial, DISPATCH
 * UNCHANGED. `instantDelivery` marks the kept remainder delivered at creation
 * (order → Delivered instead of Partial; a later courier partial webhook is
 * then a no-op).
 */
export class StaffPartialReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StaffPartialReturnItemDto)
  items!: StaffPartialReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  instantDelivery?: boolean;
}
