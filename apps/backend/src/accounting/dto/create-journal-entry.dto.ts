import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

class JournalEntryLineDto {
  @IsString() @IsNotEmpty()
  accountId: string;

  @IsNumber() @Min(0)
  debit: number;

  @IsNumber() @Min(0)
  credit: number;

  @IsOptional() @IsString()
  description?: string;
}

export class CreateJournalEntryDto {
  @IsString() @IsNotEmpty()
  periodId: string;

  @IsString() @IsNotEmpty()
  entryDate: string;

  @IsString() @IsNotEmpty()
  description: string;

  @IsOptional() @IsString()
  referenceNo?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];
}
