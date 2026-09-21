/**
 * POST /orders/:id/verify-payment body validation.
 *
 * feeAmount rides into the P&L payment-fees line, so it must be a finite
 * non-negative number at the boundary (400 before the service). @IsNumber
 * rejects NaN/Infinity by default; @Min(0) rejects negatives. Wire shape
 * ({ verified, note, feeAmount }) matches the admin payments client.
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VerifyOrderPaymentDto } from '../dto/order.dto';

function dtoOf(body: Record<string, unknown>): VerifyOrderPaymentDto {
  return plainToInstance(VerifyOrderPaymentDto, body);
}

describe('VerifyOrderPaymentDto', () => {
  it('accepts verified-only and full bodies', async () => {
    expect(await validate(dtoOf({ verified: true }))).toHaveLength(0);
    expect(
      await validate(
        dtoOf({ verified: true, note: 'ok', feeAmount: 25 }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(dtoOf({ verified: false, feeAmount: 0 })),
    ).toHaveLength(0);
  });

  it('rejects negative fees', async () => {
    const errors = await validate(
      dtoOf({ verified: true, feeAmount: -1 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('feeAmount');
  });

  it('rejects non-finite fees (Infinity / NaN)', async () => {
    for (const feeAmount of [Infinity, -Infinity, NaN]) {
      const errors = await validate(dtoOf({ verified: true, feeAmount }));
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects non-number fees and non-boolean verified', async () => {
    expect(
      await validate(dtoOf({ verified: true, feeAmount: '25' } as any)),
    ).not.toHaveLength(0);
    expect(await validate(dtoOf({} as any))).not.toHaveLength(0);
    expect(
      await validate(dtoOf({ verified: 'true' } as any)),
    ).not.toHaveLength(0);
  });
});
