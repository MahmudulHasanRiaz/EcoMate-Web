import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

// Nested salary structure captured at employee creation (G-15). Mirrors the
// payroll SetSalaryStructureDto shape minus employeeId, with effectiveFrom
// optional (defaults to today on the backend).
export class CreateSalaryStructureDto {
  @IsNumber()
  @Min(0)
  basicSalary: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  houseAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  medicalAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  transportAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherAllowance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxDeduction?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceDeduction?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherDeduction?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
