import { IsString, IsIn, IsOptional } from 'class-validator';

export class UpdateAppearanceDto {
  @IsOptional()
  @IsString()
  @IsIn(['light', 'dark'])
  theme?: string;

  @IsOptional()
  @IsString()
  font?: string;
}
