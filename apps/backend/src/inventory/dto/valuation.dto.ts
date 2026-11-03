import {
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  IsNotEmpty,
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

  // Optional at the edge: a caller that supplies no key gets a fresh
  // server-generated one (each call is then its own transfer). But a key
  // that IS supplied must never be empty — StockTransfer.idempotencyKey is
  // unique, so every empty-keyed transfer would collapse into the first
  // one and silently swallow the rest (2026-11-02 audit §A.16).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  idempotencyKey?: string;
}
