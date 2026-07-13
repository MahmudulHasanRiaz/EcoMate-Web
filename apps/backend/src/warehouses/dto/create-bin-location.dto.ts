import { IsString, IsOptional } from 'class-validator';

export class CreateBinLocationDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  rackId?: string;

  @IsOptional()
  @IsString()
  shelfId?: string;
}
