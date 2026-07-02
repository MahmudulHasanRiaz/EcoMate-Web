import {
  IsString,
  IsOptional,
  IsArray,
  IsEmail,
  MinLength,
  MaxLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(160)
  bio?: string;

  @IsOptional()
  @IsArray()
  urls?: { value: string }[];
}
