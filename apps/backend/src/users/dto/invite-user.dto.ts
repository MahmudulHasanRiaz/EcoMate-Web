import { IsEmail, IsString, IsOptional, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsOptional()
  @IsString()
  desc?: string;
}
