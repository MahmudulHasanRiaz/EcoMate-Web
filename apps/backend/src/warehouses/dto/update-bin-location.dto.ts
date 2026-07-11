import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateBinLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsString()
  rack?: string;

  @IsOptional()
  @IsString()
  shelf?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
