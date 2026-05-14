import { IsArray, IsString, IsOptional } from 'class-validator';

export class BulkDeleteTasksDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class BulkUpdateTasksDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  priority?: string;
}
