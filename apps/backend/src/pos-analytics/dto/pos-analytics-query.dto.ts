import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const POS_ANALYTICS_SCOPES = ['showroom', 'mine'] as const;
export type PosAnalyticsScope = (typeof POS_ANALYTICS_SCOPES)[number];

export const POS_ANALYTICS_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'previous_month',
  'custom',
] as const;
export type PosAnalyticsPreset = (typeof POS_ANALYTICS_PRESETS)[number];

/** Dhaka date-only YYYY-MM-DD (same idiom as AnalyticsFilterDto). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class PosAnalyticsQueryDto {
  @IsOptional()
  @IsIn([...POS_ANALYTICS_SCOPES])
  scope?: PosAnalyticsScope = 'showroom';

  @IsOptional()
  @IsIn([...POS_ANALYTICS_PRESETS])
  preset?: PosAnalyticsPreset = 'today';

  @IsOptional()
  @Matches(DATE_RE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn(['reportingAt', 'total'])
  sort?: 'reportingAt' | 'total' = 'reportingAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
