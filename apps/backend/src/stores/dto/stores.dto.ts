/**
 * Store DTOs — central-commerce §10 (P1).
 *
 * No delete-mode field exists anywhere in this design (BR-09): unpublish
 * and assignment-OFF move the external product to Draft and are never
 * deletion. Credentials are write-only (never returned by any read).
 */
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export const STORE_KINDS = ['WOOCOMMERCE', 'SHOPIFY', 'CUSTOM'] as const;
export type StoreKindDto = (typeof STORE_KINDS)[number];

export class CreateStoreDto {
  @IsIn([...STORE_KINDS] as string[])
  kind!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  /** Store base URL or myshopify domain; normalised server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  domain?: string;

  /** Provider-side store identifier (WC site URL / shop id / bridge storeId). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerStoreId?: string;

  /** Raw credential payload — encrypted at rest, never echoed back. */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ require_tld: false })
  callbackBaseUrl?: string;
}

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  /** Store settings only — no delete-mode field exists (BR-09). */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  autoSyncEnabled?: boolean;

  /**
   * P9 wizard "Sync configuration" step (additive): per-scope toggles
   * persisted into `settings.syncScope`. Merged server-side — never replaces
   * the rest of `settings`.
   */
  @IsOptional()
  @IsObject()
  syncScope?: { products?: boolean; orders?: boolean; stock?: boolean };

  /**
   * P9 wizard fixed policy display (BR-05, not editable): only
   * `adopt_existing` is accepted; persisted into
   * `settings.initialSyncPolicy` (defaults to `adopt_existing` when
   * `syncScope` is saved without an explicit policy).
   */
  @IsOptional()
  @IsIn(['adopt_existing'])
  initialSyncPolicy?: string;
}

export class RotateStoreCredentialsDto {
  @IsObject()
  credentials!: Record<string, unknown>;
}

export class TestConnectionDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;
}
