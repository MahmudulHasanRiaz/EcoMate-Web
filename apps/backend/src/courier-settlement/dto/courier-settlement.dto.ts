// ── Courier Settlement request DTOs (validated). ──

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class InvoiceListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() state?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  draft?: boolean;
  @IsOptional() @IsString() courier?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class BalanceQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() courier?: string;
}

export class UploadInvoiceDto {
  @IsOptional() @IsString() courier?: string;
  @IsOptional() @IsString() revisionOfId?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class MappingDto {
  @IsString() courier!: string;
  @IsString() @MaxLength(200) sourceHeader!: string;
  @IsString() field!: string;
  @IsOptional() @IsBoolean() alwaysUse?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() invoiceId?: string;
}

export class MappingActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() invoiceId?: string;
}

export class AcknowledgeDto {
  @IsOptional() @IsString() actorNote?: string;
}

export class AdjustmentDto {
  @IsIn(['source', 'cost', 'settlement']) adjustmentClass!: 'source' | 'cost' | 'settlement';
  @IsOptional() @IsString() rowId?: string;
  @IsString() field!: string;
  @IsOptional() adjustedValue?: string | number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsIn(['net', 'gross', 'variance']) counterpart?: 'net' | 'gross' | 'variance';
}

export class CorrectionPreviewDto {
  @Type(() => Number) @IsNumber() deltaG!: number;
  @Type(() => Number) @IsNumber() deltaC!: number;
  @Type(() => Number) @IsNumber() deltaN!: number;
  @IsOptional() @IsIn(['net', 'gross', 'variance']) counterpart?: 'net' | 'gross' | 'variance';
}

export class ReverseAdjustmentDto {
  @IsString() @MaxLength(500) reason!: string;
}

/** Pre-finalize withdrawal of an invoice (§15 duplicate resolution path). */
export class DiscardInvoiceDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class FinanceRuleDto {
  @IsString() courier!: string;
  @IsOptional() @IsString() format?: string;
  @IsIn(['declared_field', 'collected_minus_charges', 'billing_when_no_collection', 'component_sum'])
  netRule!: string;
  @IsOptional() chargeComponents?: unknown;
  @IsOptional() @Type(() => Number) @IsNumber() residualThreshold?: number;
  @IsOptional() @Type(() => Number) @IsNumber() tolerance?: number;
  @IsOptional() identifierOrder?: unknown;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** §12 rule test: candidate rule + pasted sample numbers (no formula eval). */
export class FinanceRuleTestDto {
  @IsIn(['declared_field', 'collected_minus_charges', 'billing_when_no_collection', 'component_sum'])
  netRule!: string;
  @IsOptional() chargeComponents?: unknown;
  @IsOptional() @Type(() => Number) @IsNumber() residualThreshold?: number;
  @IsOptional() @Type(() => Number) @IsNumber() tolerance?: number;
  @IsOptional() @IsObject() sample?: Record<string, unknown>;
}

export class ManualMatchDto {
  @IsString() orderId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}