import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoVariantSelect?: boolean;
}
