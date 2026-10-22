import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { ScanPurposeId } from '../scanner.types';

export const SCAN_PURPOSES: ScanPurposeId[] = [
  'DISPATCH_HANDED_OVER',
  'DISPATCH_RETURN',
  'ORDER_STATUS',
  'STICKER_PRINT',
  'RETURN_RECEIVE',
];

export class ScanResolveDto {
  @IsString()
  identifier!: string;

  @IsOptional()
  @IsIn(SCAN_PURPOSES as unknown as string[])
  purpose?: ScanPurposeId;
}

/**
 * One confirmed receive line staged by the scanner. The detail-page
 * mark-received form sends the same shape straight to the same guarded
 * funnel. `damagedQuantity` is part of the receive fact, not a later
 * adjustment — it must survive the HTTP whitelist unchanged.
 */
export class ScanItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damagedQuantity?: number;
}

export class ScanExecuteDto {
  @IsIn(SCAN_PURPOSES as unknown as string[])
  purpose!: ScanPurposeId;

  @IsString()
  identifier!: string;

  @IsOptional()
  @IsUUID()
  dispatchId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  dispatchIds?: string[];

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  orderIds?: string[];

  @IsOptional()
  @IsUUID()
  targetStatusId?: string;

  /** Hardening (3): the linked return leg selected by the picker. */
  @IsOptional()
  @IsUUID()
  returnId?: string;

  /** Hardening (3): the linked exchange selected by the picker (info-only). */
  @IsOptional()
  @IsUUID()
  exchangeId?: string;

  /**
   * Staged receive split (process return / return receive). Declared so the
   * global `whitelist: true` ValidationPipe does not silently strip it — the
   * exact bug that lost receive-phase damage before persistence.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScanItemDto)
  items?: ScanItemDto[];
}
