import {
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class GrnItemDto {
  @IsString()
  purchaseItemId: string;

  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNumber()
  receivedQty: number;

  @IsNumber()
  acceptedQty: number;

  @IsNumber()
  rejectedQty: number;
}

export class CreateGrnDto {
  @IsString()
  warehouseId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrnItemDto)
  items: GrnItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
