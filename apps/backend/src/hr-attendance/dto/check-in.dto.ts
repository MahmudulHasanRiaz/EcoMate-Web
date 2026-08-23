import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckInDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}