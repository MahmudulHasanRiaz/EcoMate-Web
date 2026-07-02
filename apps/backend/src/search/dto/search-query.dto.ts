import { Type } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @MinLength(2)
  q: string;

  @Type(() => Number)
  @IsOptional()
  limit?: number;
}
