import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  Min,
  IsUUID,
} from 'class-validator';

export class CreateRefundDto {
  @IsUUID() orderId: string;
  @IsNumber() @Min(1) amount: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() targetStatusId?: string;
  /**
   * EXCHANGE settlement only. The refund is always raised against `orderId`
   * (the original whose money is returned); this records which exchange
   * produced it, so the two stay linked in both directions.
   */
  @IsOptional() @IsUUID() exchangeOrderId?: string;
  /**
   * EXCHANGE settlement only. The exact payment row the money came back from,
   * so the refund reconciles against a real collection rather than the order
   * total. When omitted, the service picks the oldest unrefunded PAID payment.
   */
  @IsOptional() @IsUUID() sourcePaymentId?: string;
}

export class UpdateRefundStatusDto {
  @IsString()
  @IsIn(['pending', 'approved', 'completed', 'rejected'])
  status: string;
  @IsOptional() @IsString() notes?: string;
}
