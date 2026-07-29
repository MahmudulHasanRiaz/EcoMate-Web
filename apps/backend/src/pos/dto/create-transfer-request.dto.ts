import { IsString, IsOptional, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PosTransferItemDto {
  @IsString() productId: string;
  @IsOptional() @IsString() variantId?: string;
  @IsString() sourceWarehouseId: string;
  @IsInt() @Min(1) quantity: number;
}

export class CreatePosTransferRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosTransferItemDto)
  items: PosTransferItemDto[];

  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() notes?: string;
}