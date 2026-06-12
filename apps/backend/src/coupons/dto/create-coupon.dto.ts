import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class CreateCouponDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  @IsIn(['flat', 'percentage'])
  type?: string;

  @IsNumber()
  value: number;

  @IsOptional()
  @IsNumber()
  minOrderValue?: number;

  @IsOptional()
  @IsNumber()
  maxUses?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}
