import { IsNumber, Min, IsOptional, IsString } from 'class-validator';

export class CloseSessionDto {
  @IsNumber()
  @Min(0)
  closingBalance: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
