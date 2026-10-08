import {
  IsString,
  IsArray,
  IsNumber,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class ShortCloseItemDto {
  @IsString()
  purchaseItemId: string;

  @IsNumber()
  @Min(1)
  qty: number;

  @IsString()
  reason: string;
}

export class ShortClosePurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShortCloseItemDto)
  items: ShortCloseItemDto[];
}
