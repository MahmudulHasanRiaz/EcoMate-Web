import { IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 2 backfill request. `dryRun` reports what WOULD be posted without
 * writing anything, so a bulk remediation can be inspected first; `limit`
 * bounds the scan per payment kind (payroll / supplier / order receipts).
 */
export class BackfillJournalsDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}
