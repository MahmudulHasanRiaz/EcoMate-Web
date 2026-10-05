import {
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';

export class ValuationQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class StockTransferDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  sourceLocation: string;

  @IsString()
  destinationLocation: string;

  // StockTransferItem.quantity, PhysicalInventory.quantity and CostingLot
  // quantities are Int columns. Without @IsInt a fractional quantity (2.5)
  // passes validation and Prisma rejects it deep inside the transaction,
  // after the transfer header is created. Reject it at the edge instead.
  @IsNumber()
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  sourceBinId?: string;

  @IsOptional()
  @IsString()
  destinationBinId?: string;

  @IsString()
  idempotencyKey: string;
}
