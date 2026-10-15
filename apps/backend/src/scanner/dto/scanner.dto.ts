import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
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
}
