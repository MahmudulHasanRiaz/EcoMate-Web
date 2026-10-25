import {
  IsOptional,
  IsString,
  IsObject,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEmail,
  MaxLength,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpsertLeadItemDto {
  @IsOptional() @IsString() @MaxLength(100) id?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1000000000) price?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(9999) quantity?: number;
  @IsOptional() @IsString() @MaxLength(2000) image?: string;
  @IsOptional() @IsString() @MaxLength(100) comboId?: string;
}

export class UpsertLeadDto {
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpsertLeadItemDto)
  items?: UpsertLeadItemDto[];
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(100) fingerprint?: string;
  @IsOptional() @IsString() @MaxLength(100) fbp?: string;
  @IsOptional() @IsString() @MaxLength(100) fbc?: string;
  @IsOptional() @IsString() @MaxLength(100) ctxId?: string;
  /**
   * Landing signals captured by the storefront (utm / click ids / referrer) and
   * the device context. Kept so a lead converted into an order keeps its real
   * source instead of arriving blind.
   */
  @IsOptional() @IsObject() attribution?: Record<string, unknown>;
  @IsOptional() @IsObject() device?: Record<string, unknown>;
}
