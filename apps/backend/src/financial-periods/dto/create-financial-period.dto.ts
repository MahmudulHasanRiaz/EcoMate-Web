import { IsString, IsNotEmpty, IsDate, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFinancialPeriodDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @Type(() => Date)
  @IsDefined()
  @IsDate()
  startDate: Date;

  @Type(() => Date)
  @IsDefined()
  @IsDate()
  endDate: Date;
}
