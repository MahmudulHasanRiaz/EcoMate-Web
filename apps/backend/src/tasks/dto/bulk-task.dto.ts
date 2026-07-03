import { IsArray, IsString, IsOptional, IsEnum } from 'class-validator';
import { TaskStatus, TaskPriority } from '@prisma/client';

export class BulkDeleteTasksDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class BulkUpdateTasksDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}
