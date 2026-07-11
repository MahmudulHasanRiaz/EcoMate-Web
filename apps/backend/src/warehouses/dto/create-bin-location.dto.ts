import { IsString, IsOptional } from 'class-validator';

export class CreateBinLocationDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsString()
  rack?: string;

  @IsOptional()
  @IsString()
  shelf?: string;
}
