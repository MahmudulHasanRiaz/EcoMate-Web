import { IsOptional, IsString, IsInt, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ManagedStockMovementType, ReferenceEntity } from '@prisma/client';

export class LedgerQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  // The admin Movement History type filter sends these — they must be
  // declared or the global whitelist pipe silently strips them and the
  // filter never reaches the service (found in the 2026-11-02 audit).
  // Hardened to the real Prisma enums (2026-11-03): a bogus value used to
  // flow into the Prisma where as a cast and explode as a 500; it now
  // fails validation as a 400. The admin only ever sends enum members
  // (LEDGER_TYPE_OPTIONS in the drawer / movement-ledger components).
  @IsOptional()
  @IsEnum(ManagedStockMovementType)
  type?: ManagedStockMovementType;

  @IsOptional()
  @IsEnum(ReferenceEntity)
  referenceType?: ReferenceEntity;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number;
}
