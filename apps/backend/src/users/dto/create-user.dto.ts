import {
  IsString,
  IsEmail,
  MinLength,
  IsEnum,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsString()
  @MinLength(1)
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  phoneNumber: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;
}
