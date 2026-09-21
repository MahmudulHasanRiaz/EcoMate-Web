/**
 * Business analytics expenses query DTO (P9, §2.9 + §4.1 + §4.2 expense rows).
 *
 * Extends the single shared filter — range (and the order dimensions that
 * shape the recognised-revenue denominator via the reused P2 pnl) still land
 * in the backend query. Adds the expense narrow only: category, kind,
 * description search, sort and pagination. There is intentionally NO Store
 * dimension (F7). Expense has no trash field, so no trash filter exists.
 */
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsFilterDto } from './analytics-filter.dto';

export const EXPENSE_KINDS = ['fixed', 'variable', 'unclassified'] as const;
export type ExpenseKindFilter = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_SORTS = ['total', 'name', 'expenseDate'] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];

export const EXPENSES_DEFAULT_PAGE = 1;
export const EXPENSES_DEFAULT_PAGE_SIZE = 20;
export const EXPENSES_MAX_PAGE_SIZE = 100;

export class ExpensesQueryDto extends AnalyticsFilterDto {
  /** ExpenseCategory narrow (§4.2: category → expense list). */
  @IsOptional()
  @IsString()
  expenseCategoryId?: string;

  /** fixed | variable | unclassified — staff-classified, never inferred. */
  @IsOptional()
  @IsIn([...EXPENSE_KINDS])
  expenseKind?: ExpenseKindFilter;

  /** Expense description substring (case-insensitive, DB-side). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...EXPENSE_SORTS])
  sort?: ExpenseSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  /** 1-based list page (aggregate endpoints ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** List page size, capped for honesty (aggregates ignore it). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPENSES_MAX_PAGE_SIZE)
  pageSize?: number;
}

/** Clamp raw query pagination to the documented bounds. */
export function expensesPagination(query: ExpensesQueryDto): {
  page: number;
  pageSize: number;
} {
  const page =
    Number.isInteger(query.page) && (query.page as number) >= 1
      ? (query.page as number)
      : EXPENSES_DEFAULT_PAGE;
  const pageSize =
    Number.isInteger(query.pageSize) &&
    (query.pageSize as number) >= 1 &&
    (query.pageSize as number) <= EXPENSES_MAX_PAGE_SIZE
      ? (query.pageSize as number)
      : EXPENSES_DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}
