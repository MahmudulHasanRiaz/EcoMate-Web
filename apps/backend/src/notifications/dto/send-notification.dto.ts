import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class SendNotificationDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['email'])
  channel: string;

  @IsString()
  @IsNotEmpty()
  eventType: string;

  @IsString()
  @IsNotEmpty()
  recipient: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  content?: string;
}
