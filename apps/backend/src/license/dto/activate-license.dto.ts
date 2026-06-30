import { IsString, IsOptional } from 'class-validator';

export class ActivateLicenseDto {
  @IsString()
  licenseKey: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}
