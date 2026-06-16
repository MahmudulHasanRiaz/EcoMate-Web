import { IsOptional, IsString, IsObject, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class UpsertLeadItemDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() comboId?: string;
}

export class UpsertLeadDto {
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertLeadItemDto)
  items?: UpsertLeadItemDto[];
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() fingerprint?: string;
}
