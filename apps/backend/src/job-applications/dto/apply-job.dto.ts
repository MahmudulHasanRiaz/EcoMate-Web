import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Visitor application fields. The CV itself arrives as the multipart `cv`
 * file part (validated by magic bytes in cv-file.ts), and the honeypot
 * `website` field must stay empty — a filled honeypot is silently dropped
 * by the service without creating a record.
 */
export class ApplyJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  coverLetter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  portfolioUrl?: string;

  /** Honeypot — human visitors never fill this (hidden field). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
