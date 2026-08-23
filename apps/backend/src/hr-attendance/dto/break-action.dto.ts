import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BreakActionDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}