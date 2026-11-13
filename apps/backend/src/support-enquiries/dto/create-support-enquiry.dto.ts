import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSupportEnquiryDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  orderId?: string;

  /**
   * Honeypot — a real visitor never fills this (the field is hidden).
   * A non-empty value means a bot: the request is accepted with a fake
   * success and nothing is stored. There is no honeypot pattern for
   * public forms elsewhere in this codebase; this follows the usual
   * hidden-field convention.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
