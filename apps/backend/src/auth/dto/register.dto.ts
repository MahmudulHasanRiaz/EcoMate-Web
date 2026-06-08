import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../validators/password.validator';

export class RegisterDto {
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
  @IsStrongPassword()
  password: string;

  @IsString()
  phoneNumber: string;
}
