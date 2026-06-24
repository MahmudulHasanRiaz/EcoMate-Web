import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SendNotificationDto {
  @IsString()
  @IsNotEmpty()
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
