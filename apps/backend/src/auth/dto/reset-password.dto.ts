import { IsString } from 'class-validator';
import { IsStrongPassword } from '../validators/password.validator';

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @IsStrongPassword()
  password: string;
}
