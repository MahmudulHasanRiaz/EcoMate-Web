import {
  IsString,
  MinLength,
  IsOptional,
  IsDateString,
  IsEnum,
  IsNumber,
} from 'class-validator';
import { TaskStatus, TaskLabel, TaskPriority } from '@prisma/client';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsEnum(TaskStatus)
  status: TaskStatus;

  @IsEnum(TaskLabel)
  label: TaskLabel;

  @IsEnum(TaskPriority)
  priority: TaskPriority;

  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @IsString()
  assignedEmployeeId?: string;

  @IsOptional()
  @IsNumber()
  estimatedMinutes?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
