import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateSelfLeaveRequestDto {
  @IsString()
  @IsNotEmpty()
  typeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  // Explicitly ignored: the employee id is always server-resolved from the session.
  employeeId?: string;
}
