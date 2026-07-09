import { IsString, IsOptional, IsIn } from 'class-validator';

export class HoldOrderDto {
  @IsString()
  @IsIn([
    'Product Missing',
    'Stock Issue',
    'Damaged Product',
    'Waiting for Approval',
    'Customer Request',
    'Other',
  ])
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PackingQueueQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
