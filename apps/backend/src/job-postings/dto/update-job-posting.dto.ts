import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { EMPLOYMENT_TYPES, JOB_POSTING_STATUSES } from './create-job-posting.dto';

export class UpdateJobPostingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  designationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsIn([...EMPLOYMENT_TYPES])
  employmentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  salaryDisplay?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  requirements?: string | null;

  @IsOptional()
  @IsString()
  responsibilities?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benefits?: string[] | null;

  @IsOptional()
  @IsDateString()
  deadline?: string | null;

  @IsOptional()
  @IsIn([...JOB_POSTING_STATUSES])
  status?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
