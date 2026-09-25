/**
 * Distribution DTOs — central-commerce §10 (P3).
 *
 * All mutations carry row-level storeId validation in the service; NATIVE
 * store ids are rejected 400 on writes (BR-20). Disable-all requires the
 * typed confirmation `DISABLE`.
 */
import { IsBoolean, IsDefined, IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class PutAvailabilityDto {
  @IsUUID()
  storeId!: string;

  /** null clears the MANUAL override (falls back to rule ?? default) */
  @IsDefined()
  @ValidateIf((o: PutAvailabilityDto) => o.available !== null && o.available !== undefined)
  @IsBoolean()
  available!: boolean | null;
}

export class BulkAvailabilityDto {
  @IsIn(['all_on', 'all_off'])
  action!: 'all_on' | 'all_off';

  /** required (=== 'DISABLE') for all_off */
  @IsOptional()
  @IsString()
  confirm?: string;
}

export class UpsertRuleDto {
  @IsUUID()
  storeId!: string;

  @IsBoolean()
  available!: boolean;

  @IsOptional()
  @IsBoolean()
  inheritFromParent?: boolean;
}
