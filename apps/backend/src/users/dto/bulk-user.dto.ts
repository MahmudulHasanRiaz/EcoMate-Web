import { IsArray, IsString, IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class BulkDeleteUsersDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class BulkUpdateUsersDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsEnum(UserStatus)
  status: UserStatus;
}
