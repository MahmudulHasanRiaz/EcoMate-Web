import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ClaimReferralDto {
  @IsString() @IsNotEmpty()
  code: string;

  @IsString() @IsNotEmpty()
  phone: string;

  @IsOptional() @IsString()
  name?: string;
}
