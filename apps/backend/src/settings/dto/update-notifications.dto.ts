import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';

export class UpdateNotificationsDto {
  @IsString()
  @IsIn(['all', 'mentions', 'none'])
  type: string;

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

  @IsBoolean()
  security_emails: boolean;
}
