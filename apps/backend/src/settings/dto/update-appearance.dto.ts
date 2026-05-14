import { IsString, IsIn } from 'class-validator';

export class UpdateAppearanceDto {
  @IsString()
  @IsIn(['light', 'dark'])
  theme: string;

  @IsString()
  font: string;
}
