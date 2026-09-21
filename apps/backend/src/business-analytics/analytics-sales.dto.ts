/**
 * Business analytics sales query DTO (P5, §4.1 + §4.2 sales rows).
 *
 * Extends the single shared filter — every dimension still lands in the
 * backend query. Adds settlement-table pagination only (page/pageSize);
 * all aggregate endpoints ignore pagination. There is intentionally NO
 * Store dimension (F7).
 */
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsFilterDto } from './analytics-filter.dto';

export const SALES_SETTLEMENT_DEFAULT_PAGE = 1;
export const SALES_SETTLEMENT_DEFAULT_PAGE_SIZE = 20;
export const SALES_SETTLEMENT_MAX_PAGE_SIZE = 100;

export class SalesQueryDto extends AnalyticsFilterDto {
  /** 1-based settlement-table page (aggregate endpoints ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Settlement-table page size, capped for honesty (aggregate endpoints ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALES_SETTLEMENT_MAX_PAGE_SIZE)
  pageSize?: number;
}

/** Clamp raw query pagination to the documented bounds. */
export function salesPagination(query: SalesQueryDto): {
  page: number;
  pageSize: number;
} {
  const page =
    Number.isInteger(query.page) && (query.page as number) >= 1
      ? (query.page as number)
      : SALES_SETTLEMENT_DEFAULT_PAGE;
  const pageSize =
    Number.isInteger(query.pageSize) &&
    (query.pageSize as number) >= 1 &&
    (query.pageSize as number) <= SALES_SETTLEMENT_MAX_PAGE_SIZE
      ? (query.pageSize as number)
      : SALES_SETTLEMENT_DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}
