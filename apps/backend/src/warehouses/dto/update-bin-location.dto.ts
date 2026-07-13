import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateBinLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  rackId?: string;

  @IsOptional()
  @IsString()
  shelfId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
