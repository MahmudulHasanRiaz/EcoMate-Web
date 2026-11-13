import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Internship',
] as const;

export const JOB_POSTING_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;

export class CreateJobPostingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  location!: string;

  @IsOptional()
  @IsIn([...EMPLOYMENT_TYPES])
  employmentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  salaryDisplay?: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsString()
  requirements?: string;

  @IsOptional()
  @IsString()
  responsibilities?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benefits?: string[];

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsIn([...JOB_POSTING_STATUSES])
  status?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
