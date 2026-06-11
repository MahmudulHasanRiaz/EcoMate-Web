export class PaginatedProductsDto {
  page?: number;
  perPage?: number;
  search?: string;
  categoryId?: string;
  type?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
