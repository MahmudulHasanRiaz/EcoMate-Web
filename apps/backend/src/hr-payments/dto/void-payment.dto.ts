import { IsString, IsNotEmpty } from 'class-validator';

export class VoidPaymentDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
