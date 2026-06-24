import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class SetSalaryStructureDto {
  @IsString() @IsNotEmpty()
  employeeId: string;

  @IsNumber() @Min(0)
  basicSalary: number;

  @IsOptional() @IsNumber() @Min(0)
  houseAllowance?: number;

  @IsOptional() @IsNumber() @Min(0)
  medicalAllowance?: number;

  @IsOptional() @IsNumber() @Min(0)
  transportAllowance?: number;

  @IsOptional() @IsNumber() @Min(0)
  otherAllowance?: number;

  @IsOptional() @IsNumber() @Min(0)
  taxDeduction?: number;

  @IsOptional() @IsNumber() @Min(0)
  insuranceDeduction?: number;

  @IsOptional() @IsNumber() @Min(0)
  otherDeduction?: number;
}
