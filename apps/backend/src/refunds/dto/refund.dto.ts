import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsNotEmpty,
  IsBoolean,
  IsArray,
  Min,
  IsUUID,
} from 'class-validator';

export class CreateRefundDto {
  @IsUUID() orderId: string;
  @IsNumber() @Min(1) amount: number;
  /**
   * Task 9 (D5): where the money went back (gateway code / account label,
   * e.g. 'bkash'). Required — a refund without a destination is an
   * unauditable money movement. Persisted on the Refund row AND mirrored
   * onto the negative payment ledger row (gatewayCode/account).
   */
  @IsString() @IsNotEmpty() method: string;
  /**
   * Task 9 (D5): human reason for the refund. Required — doubles as the
   * notes on the mirrored negative ledger row (negative corrections must
   * always carry a reason).
   */
  @IsString() @IsNotEmpty() reason: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() targetStatusId?: string;
  /**
   * Task 9 (D5): atomic cancel-too. When true the same $transaction that
   * writes the refund + negative ledger row also transitions the order to
   * Cancelled (+ timeline entries for both). Requires a FULL refund
   * (amount covers the outstanding balance); a partial amount is rejected
   * because the cancel gate would still block afterwards. When false or
   * omitted, refunds only. Takes precedence over targetStatusId.
   */
  @IsOptional() @IsBoolean() cancelToo?: boolean;
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
  /**
   * D-B: refund via payment-list selection. The exact PAID payment rows the
   * money comes back from (checkbox selection in the payment ledger). The
   * service enforces: every id exists and belongs to `orderId` (same-order),
   * every row is PAID (pending rows 400 first), and the requested total fits
   * the summed per-row remainders (row.amount − Σ non-rejected refunds by
   * sourcePaymentId) — so a repeated refund of the same row 400s via the cap.
   * The total is distributed across the rows in the given order and each slice
   * becomes its own Refund row + negative ledger row + timeline entry (one
   * call returns an array when several rows are produced).
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sourcePaymentIds?: string[];
}

export class UpdateRefundStatusDto {
  @IsString()
  @IsIn(['pending', 'approved', 'completed', 'rejected'])
  status: string;
  @IsOptional() @IsString() notes?: string;
}
