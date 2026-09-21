/**
 * Business analytics products query DTO (P4, §4.1 + §2.6).
 *
 * Extends the single shared filter — every dimension still lands in the
 * backend query. Adds list-only concerns: name search (DB-side, never
 * client-side), metric sort, and direction. There is intentionally NO Store
 * dimension (F7).
 */
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AnalyticsFilterDto } from './analytics-filter.dto';

export const PRODUCT_SORTS = [
  'netSales',
  'units',
  'contribution',
  'margin',
  'returnRate',
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export class ProductsQueryDto extends AnalyticsFilterDto {
  /** Product name substring (case-insensitive, DB-side). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...PRODUCT_SORTS])
  sort?: ProductSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}

/** Item-scoping filters narrow the LINE universe (R1 warns while scoped). */
export function hasProductLineScope(query: ProductsQueryDto): boolean {
  return Boolean(
    query.productId ??
      query.variantId ??
      query.categoryId ??
      query.warehouseId ??
      query.search,
  );
}
