/**
 * Business analytics inventory DTO (P8, §2.8 + §4.1).
 *
 * Relevant subset of the single shared filter for inventory-scoped pages:
 * range + warehouse (fulfillment location) + product/variant/category
 * dimensions. Adds list-only concerns: name search (DB-side), metric sort,
 * direction, and pagination. There is intentionally NO Store dimension (F7).
 */
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsFilterDto } from './analytics-filter.dto';

export const INVENTORY_SORTS = [
  'closingUnits',
  'unitsSold',
  'doi',
  'sellThrough',
  'stockoutDays',
] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];

export class InventoryQueryDto extends AnalyticsFilterDto {
  /** Product name substring (case-insensitive, DB-side). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...INVENTORY_SORTS])
  sort?: InventorySort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Pagination defaults for the movement/stockout/ledger lists. */
export function inventoryPagination(query: InventoryQueryDto): {
  page: number;
  pageSize: number;
} {
  return { page: query.page ?? 1, pageSize: query.pageSize ?? 20 };
}
