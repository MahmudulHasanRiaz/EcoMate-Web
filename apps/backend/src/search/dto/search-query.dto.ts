import { Type } from 'class-transformer';
import { IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @MinLength(2)
  q: string;

  @Type(() => Number)
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;
}
