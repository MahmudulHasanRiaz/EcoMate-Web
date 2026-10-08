import { IsString } from 'class-validator';

export class CancelPurchaseDto {
  @IsString()
  reason: string;
}
