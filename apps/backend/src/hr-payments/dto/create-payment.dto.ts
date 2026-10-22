import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request body for recording a payroll payment.
 *
 * `payslipId` is deliberately NOT part of the body: the route carries it
 * (`POST /payroll/payslips/:id/payments`) and the controller injects it. Nest
 * validates `@Body()` against this class BEFORE the handler runs, so a required
 * `payslipId` here rejected every legitimate request with
 * "payslipId should not be empty" and the merge never executed.
 */
export class CreatePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  method?: string;

  /** Part 5: eligible CoA asset leaf used to pay the salary. */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Service-layer input: the validated body plus the payslip id the controller
 * takes from the path param. Keeps the service contract unchanged.
 */
export type CreatePaymentInput = CreatePaymentDto & { payslipId: string };
