import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  ValidateNested,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAttributeValueDto {
  @IsString()
  @MinLength(1)
  value: string;
  @IsOptional()
  @IsString()
  hexCode?: string;
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateAttributeDto {
  @IsString()
  @MinLength(1)
  name: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAttributeValueDto)
  values?: CreateAttributeValueDto[];
}

export class UpdateAttributeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
