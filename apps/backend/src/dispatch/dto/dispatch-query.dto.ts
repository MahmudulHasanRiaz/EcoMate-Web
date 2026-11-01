import { IsOptional, IsString } from 'class-validator';

export class DispatchQueryDto {
  @IsOptional()
  @IsString()
  orderId?: string;
  /** 'true' → only UNMATCHED dispatches (orderId NULL). */
  @IsOptional()
  @IsString()
  unmatched?: string;
  @IsOptional()
  @IsString()
  courier?: string;
  @IsOptional()
  @IsString()
  status?: string;
  @IsOptional()
  @IsString()
  search?: string;
  @IsOptional()
  @IsString()
  startDate?: string;
  @IsOptional()
  @IsString()
  endDate?: string;
  @IsOptional()
  @IsString()
  page?: string;
  @IsOptional()
  @IsString()
  perPage?: string;
}
