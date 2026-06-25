import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class SetOpeningBalanceDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  periodId: string;

  @IsNumber()
  @Min(0)
  debit: number;

  @IsNumber()
  @Min(0)
  credit: number;
}
