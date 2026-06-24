import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class CreateTemplateDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  subject: string;

  @IsString() @IsNotEmpty()
  body: string;

  @IsOptional() @IsArray()
  variables?: string[];

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
