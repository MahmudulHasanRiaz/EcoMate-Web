import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const JOB_APPLICATION_STATUSES = [
  'NEW',
  'SHORTLISTED',
  'INTERVIEW',
  'REJECTED',
  'HIRED',
] as const;

export class UpdateJobApplicationDto {
  @IsOptional()
  @IsIn([...JOB_APPLICATION_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNote?: string | null;
}
