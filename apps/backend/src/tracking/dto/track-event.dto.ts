import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class TrackEventDto {
  @IsString()
  @IsNotEmpty()
  eventName: string;

  @IsString()
  @IsOptional()
  eventId?: string;

  @IsObject()
  @IsOptional()
  customData?: Record<string, any>;

  @IsObject()
  @IsOptional()
  userData?: Record<string, any>;
}
