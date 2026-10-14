import { IsString } from 'class-validator';

export class CancelCarrybeeOrderDto {
  @IsString()
  reason: string;
}
