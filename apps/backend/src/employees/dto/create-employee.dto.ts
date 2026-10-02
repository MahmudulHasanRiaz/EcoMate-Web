import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  ValidateNested,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EmploymentType,
  EmployeeStatus,
  EmployeeGender,
  AttendanceMethod,
} from '@prisma/client';
import { CreateSalaryStructureDto } from './create-salary-structure.dto';
import { CreateEmployeeBankAccountDto } from './create-employee-bank-account.dto';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  betterAuthUserId: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsString()
  accessPresetId?: string;

  @IsOptional()
  @IsString()
  reportingToId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsDateString()
  @IsNotEmpty()
  joiningDate: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsDateString()
  exitDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSalaryStructureDto)
  salaryStructure?: CreateSalaryStructureDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateEmployeeBankAccountDto)
  bankAccount?: CreateEmployeeBankAccountDto;

  @IsOptional()
  @IsString()
  profilePictureUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(EmployeeGender)
  gender?: EmployeeGender;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  nidNumber?: string;

  @IsOptional()
  @IsString()
  presentAddress?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  @IsDateString()
  confirmationDate?: string;

  @IsOptional()
  @IsString()
  exitReason?: string;

  @IsOptional()
  @IsEnum(AttendanceMethod)
  attendanceMethod?: AttendanceMethod;

  @IsOptional()
  @IsString()
  shiftPresetId?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  shiftDays?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftRotationItemDto)
  shiftRotations?: ShiftRotationItemDto[];
}

export class ShiftRotationItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  shiftPresetId: string;
}
