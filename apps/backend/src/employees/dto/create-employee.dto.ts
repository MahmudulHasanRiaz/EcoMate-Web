import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, IsDateString, IsNumber, Min } from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString() @IsNotEmpty()
  firstName: string;

  @IsString() @IsNotEmpty()
  lastName: string;

  @IsEmail() @IsNotEmpty()
  email: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsString()
  departmentId?: string;

  @IsOptional() @IsString()
  designationId?: string;

  @IsOptional() @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsDateString() @IsNotEmpty()
  joiningDate: string;

  @IsOptional() @IsNumber() @Min(0)
  salary?: number;

  @IsOptional() @IsString()
  bankAccountNo?: string;

  @IsOptional() @IsString()
  bankName?: string;

  @IsOptional() @IsString()
  address?: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  emergencyContact?: string;

  @IsOptional() @IsString()
  notes?: string;
}
