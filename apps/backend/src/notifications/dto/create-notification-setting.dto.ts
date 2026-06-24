import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateNotificationSettingDto {
  @IsString()
  @IsNotEmpty()
  channel: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  config?: Record<string, any>;
}
