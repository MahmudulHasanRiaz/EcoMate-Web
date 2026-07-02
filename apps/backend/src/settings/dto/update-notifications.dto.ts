import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';

export class UpdateNotificationsDto {
  @IsOptional()
  @IsString()
  @IsIn(['all', 'mentions', 'none'])
  type?: string;

  @IsOptional()
  @IsBoolean()
  mobile?: boolean;

  @IsOptional()
  @IsBoolean()
  communication_emails?: boolean;

  @IsOptional()
  @IsBoolean()
  social_emails?: boolean;

  @IsOptional()
  @IsBoolean()
  marketing_emails?: boolean;

  @IsOptional()
  @IsBoolean()
  security_emails?: boolean;
}
