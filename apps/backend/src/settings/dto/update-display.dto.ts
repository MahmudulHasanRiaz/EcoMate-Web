import { IsArray, IsString, IsOptional } from 'class-validator';

export class UpdateDisplayDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  items?: string[];
}
