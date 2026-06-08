import { IsString, IsOptional, IsBoolean, IsArray, MinLength } from 'class-validator';

export class CreateSizeChartDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsArray() tableData?: any[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSizeChartDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsArray() tableData?: any[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}
