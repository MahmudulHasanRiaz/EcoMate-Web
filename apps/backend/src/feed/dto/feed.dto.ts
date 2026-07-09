import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFeedConfigDto {
  @IsString()
  @IsIn(['meta', 'google', 'tiktok'])
  platform: string;

  @IsOptional()
  @IsBoolean()
  excludeOutOfStock?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minPriceFilter?: number;
}

export class UpdateFeedConfigDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  excludeOutOfStock?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minPriceFilter?: number;
}
