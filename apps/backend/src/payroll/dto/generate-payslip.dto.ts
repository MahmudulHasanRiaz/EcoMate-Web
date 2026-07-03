import { IsString, IsNotEmpty, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class GeneratePayslipDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @Type(() => Date)
  @IsDate()
  periodStart: Date;

  @Type(() => Date)
  @IsDate()
  periodEnd: Date;
}
