import { IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFinancialPeriodDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @Type(() => Date)
  startDate: Date;

  @Type(() => Date)
  endDate: Date;
}
