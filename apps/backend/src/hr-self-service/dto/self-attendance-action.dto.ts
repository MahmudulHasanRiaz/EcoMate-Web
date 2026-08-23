import { IsDateString, IsOptional, IsString } from 'class-validator';

export class SelfAttendanceActionDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}