import { IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class GeneratePayslipDto {
  @IsString() @IsNotEmpty()
  employeeId: string;

  @Type(() => Date)
  periodStart: Date;

  @Type(() => Date)
  periodEnd: Date;
}
