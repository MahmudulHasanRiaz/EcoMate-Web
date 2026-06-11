import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class UpsertGatewayConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, any>;
}
