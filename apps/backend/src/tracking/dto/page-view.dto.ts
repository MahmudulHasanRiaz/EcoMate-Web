import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class PageViewDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  referrer?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;
}
