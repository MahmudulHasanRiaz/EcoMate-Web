import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class DecideLeaveRequestDto {
  @IsOptional()
  @IsString()
  decisionNote?: string;
}
