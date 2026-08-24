import { PartialType } from '@nestjs/mapped-types';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';

// UpdateEmployeeDto keeps the legacy flat salary/bank fields so the update
// path (and existing admin edit dialog) is unaffected by the G-15 nested
// create rework — only CreateEmployeeDto drops them.
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @IsOptional()
  @IsNumber()
  @Min(0)
  salary?: number;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  bankName?: string;
}
