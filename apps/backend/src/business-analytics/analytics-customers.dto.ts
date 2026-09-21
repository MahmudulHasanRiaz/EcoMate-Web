/**
 * Business analytics customers DTO (P6, §4.1 + §4.2 customer rows).
 *
 * Extends the single shared filter — every dimension still lands in the
 * backend query. Adds list pagination (page/pageSize) plus an optional
 * segment narrow for the drill path (segment → customer → order history).
 * There is intentionally NO Store dimension (F7).
 */
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsFilterDto } from './analytics-filter.dto';

export const CUSTOMERS_DEFAULT_PAGE = 1;
export const CUSTOMERS_DEFAULT_PAGE_SIZE = 20;
export const CUSTOMERS_MAX_PAGE_SIZE = 100;

export const CUSTOMER_LIST_SEGMENTS = ['new', 'returning', 'vip'] as const;
export type CustomerListSegment = (typeof CUSTOMER_LIST_SEGMENTS)[number];

export class CustomersQueryDto extends AnalyticsFilterDto {
  /** 1-based customer-list page (aggregate endpoints ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Customer-list page size, capped for honesty (aggregates ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CUSTOMERS_MAX_PAGE_SIZE)
  pageSize?: number;

  /** Drill narrow: segment → customer rows of one segment. */
  @IsOptional()
  @IsIn(['new', 'returning', 'vip'])
  segment?: CustomerListSegment;
}

/** Clamp raw query pagination to the documented bounds. */
export function customersPagination(query: CustomersQueryDto): {
  page: number;
  pageSize: number;
} {
  const page =
    Number.isInteger(query.page) && (query.page as number) >= 1
      ? (query.page as number)
      : CUSTOMERS_DEFAULT_PAGE;
  const pageSize =
    Number.isInteger(query.pageSize) &&
    (query.pageSize as number) >= 1 &&
    (query.pageSize as number) <= CUSTOMERS_MAX_PAGE_SIZE
      ? (query.pageSize as number)
      : CUSTOMERS_DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}
