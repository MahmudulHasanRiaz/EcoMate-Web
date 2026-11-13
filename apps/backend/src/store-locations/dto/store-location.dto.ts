import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEmail,
  IsUrl,
  IsIn,
  IsDateString,
  IsArray,
  ValidateNested,
  MinLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { isGoogleMapsUrl } from '../google-maps-url';

export const STORE_LOCATION_TYPES = ['SHOWROOM', 'BRANCH', 'OFFICE'] as const;
export type StoreLocationType = (typeof STORE_LOCATION_TYPES)[number];

/** Social link shown on the storefront only when the store has it. */
export class StoreSocialDto {
  @IsString()
  @MinLength(1)
  platform: string;

  @IsUrl()
  url: string;
}

@ValidatorConstraint({ name: 'isGoogleMapsUrl', async: false })
class IsGoogleMapsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    // Empty string means "clear / unset" — the service normalises it to null.
    return (
      value === '' || (typeof value === 'string' && isGoogleMapsUrl(value))
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid Google Maps link (maps.app.goo.gl or google.com/maps)`;
  }
}

export class CreateStoreLocationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn([...STORE_LOCATION_TYPES])
  type: StoreLocationType;

  @IsString()
  @MinLength(1)
  address: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  hours?: string;

  @IsOptional()
  @IsString()
  @Validate(IsGoogleMapsUrlConstraint)
  mapUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreSocialDto)
  socials?: StoreSocialDto[];

  /** Media-library image URL (string). No new uploader — picked in admin. */
  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsBoolean()
  comingSoon?: boolean;

  @IsOptional()
  @IsDateString()
  openingDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateStoreLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn([...STORE_LOCATION_TYPES])
  type?: StoreLocationType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  hours?: string;

  @IsOptional()
  @IsString()
  @Validate(IsGoogleMapsUrlConstraint)
  mapUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreSocialDto)
  socials?: StoreSocialDto[];

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsBoolean()
  comingSoon?: boolean;

  @IsOptional()
  @IsDateString()
  openingDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
