import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';

// UpdateEmployeeDto keeps the legacy flat salary/bank fields so the update
// path (and existing admin edit dialog) is unaffected by the G-15 nested
// create rework — only CreateEmployeeDto drops them.
//
// betterAuthUserId is omitted: it is the employee's identity link, created once
// and immutable after. PartialType inherited it, so a PUT could silently
// re-point an employee at a different login with no audit trail. The service
// strips it as defence in depth.
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['betterAuthUserId'] as const),
) {
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

  /**
   * HR-only custom access adjustments (owner 2026-10-24, Q3). These live
   * ONLY in Employee Management — normal User Management must never offer
   * them. Additions widen the preset; removals narrow it. Empty array =
   * clear that list; undefined = leave unchanged.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customAccessAdds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customAccessRemoves?: string[];
}
