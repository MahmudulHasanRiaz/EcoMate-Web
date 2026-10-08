import {
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreatePurchaseItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  totalBill: number;
}

export class CreatePurchaseDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items: CreatePurchaseItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
