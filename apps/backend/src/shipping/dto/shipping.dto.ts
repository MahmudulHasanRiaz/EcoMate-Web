import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsIn, Min } from 'class-validator';

export class CreateShippingOptionDto {
  @IsString() name: string;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
}

export class UpdateShippingOptionDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
}

export class CreateShippingZoneGroupDto {
  @IsOptional() @IsString() label?: string;
  @IsString() @IsIn(['custom_amount', 'no_delivery']) type: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsArray() @IsString({ each: true }) districts: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateShippingZoneGroupDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() @IsIn(['custom_amount', 'no_delivery']) type?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) districts?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}
