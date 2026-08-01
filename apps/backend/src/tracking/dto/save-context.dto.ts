import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class SaveContextDto {
  @IsString()
  @IsNotEmpty()
  ctxId: string;

  @IsObject()
  @IsOptional()
  identifiers?: Record<string, Record<string, string | undefined>>;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  referrer?: string;
}
