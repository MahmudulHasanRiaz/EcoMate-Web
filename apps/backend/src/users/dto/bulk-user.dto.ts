import { IsArray, IsString } from 'class-validator';

export class BulkDeleteUsersDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class BulkUpdateUsersDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsString()
  status: string;
}
