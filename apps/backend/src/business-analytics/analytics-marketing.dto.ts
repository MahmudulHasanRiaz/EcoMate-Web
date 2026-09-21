/**
 * Business analytics marketing query DTO (P7, §4.1 + §4.2 marketing rows).
 *
 * Extends the single shared filter — every dimension still lands in the
 * backend query. Adds undated-fix-list pagination only (page/pageSize);
 * all aggregate endpoints ignore pagination. There is intentionally NO
 * Store dimension (F7).
 */
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsFilterDto } from './analytics-filter.dto';

export const MARKETING_UNDATED_DEFAULT_PAGE = 1;
export const MARKETING_UNDATED_DEFAULT_PAGE_SIZE = 20;
export const MARKETING_UNDATED_MAX_PAGE_SIZE = 100;

export class MarketingQueryDto extends AnalyticsFilterDto {
  /** 1-based undated-fix-list page (aggregate endpoints ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Undated-fix-list page size, capped for honesty (aggregates ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MARKETING_UNDATED_MAX_PAGE_SIZE)
  pageSize?: number;
}

/** Clamp raw query pagination to the documented bounds. */
export function marketingPagination(query: MarketingQueryDto): {
  page: number;
  pageSize: number;
} {
  const page =
    Number.isInteger(query.page) && (query.page as number) >= 1
      ? (query.page as number)
      : MARKETING_UNDATED_DEFAULT_PAGE;
  const pageSize =
    Number.isInteger(query.pageSize) &&
    (query.pageSize as number) >= 1 &&
    (query.pageSize as number) <= MARKETING_UNDATED_MAX_PAGE_SIZE
      ? (query.pageSize as number)
      : MARKETING_UNDATED_DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}
