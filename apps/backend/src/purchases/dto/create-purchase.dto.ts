import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum, IsArray, ValidateNested, Min, IsDate } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseStatus } from '@prisma/client';

export class CreatePurchaseItemDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreatePurchaseDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsNotEmpty()
  referenceNo: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  orderDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedDate?: Date;

  @IsEnum(PurchaseStatus)
  @IsOptional()
  status?: PurchaseStatus;

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsNumber()
  @Min(0)
  total: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  paidAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items: CreatePurchaseItemDto[];
}
