import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const RETURN_TYPES = ['FULL', 'PARTIAL', 'EXCHANGE'] as const;
export const RETURN_SOURCES = ['STAFF', 'COURIER', 'EXCHANGE'] as const;
export const RETURN_STATUSES = ['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'RESTOCKED', 'CLOSED'] as const;

export type ReturnTypeInput = (typeof RETURN_TYPES)[number];
export type ReturnSourceInput = (typeof RETURN_SOURCES)[number];

export class ReturnItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateReturnDto {
  @IsUUID()
  orderId!: string;

  @IsIn([...RETURN_TYPES])
  type!: ReturnTypeInput;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items?: ReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsIn([...RETURN_SOURCES])
  source?: ReturnSourceInput;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  courier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierReturnId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierStatus?: string;

  @IsOptional()
  @IsUUID()
  exchangeOrderId?: string;
}

export class MarkReceivedDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items?: ReturnItemDto[];
}

export class LinkRefundDto {
  @IsUUID()
  refundId!: string;
}

export class ListReturnsQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsIn([...RETURN_STATUSES])
  status?: string;

  @IsOptional()
  @IsIn([...RETURN_TYPES])
  type?: string;

  @IsOptional()
  @IsIn([...RETURN_SOURCES])
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}
