import { BadRequestException } from '@nestjs/common';
import { assertNoManualLines } from '../return-guard';

/**
 * Workstream C (owner 2026-11-11): manual order lines are EXCLUDED from
 * return + exchange entirely — the same hard gate pattern used for
 * customized lines, enforced in the backend (returns, staff-partial,
 * exchange), not just hidden in the UI.
 */
describe('assertNoManualLines (WS-C)', () => {
  const productLine = {
    productId: 'prod-1',
    variantId: null,
    isManual: false,
    manualName: null,
    product: { name: 'Wallet' },
  };
  const manualLine = {
    productId: null,
    variantId: null,
    isManual: true,
    manualName: 'Gift wrapping',
    product: null,
  };

  it('allows a normal product-line request on an order without manual lines', () => {
    expect(() =>
      assertNoManualLines([productLine], [{ productId: 'prod-1' }]),
    ).not.toThrow();
  });

  it('allows product lines even when the order also has manual lines (only the manual line is excluded)', () => {
    expect(() =>
      assertNoManualLines(
        [productLine, manualLine],
        [{ productId: 'prod-1', quantity: 1 }],
      ),
    ).not.toThrow();
  });

  it('rejects a request that itself flags a manual line', () => {
    expect(() =>
      assertNoManualLines(
        [productLine, manualLine],
        [{ isManual: true, manualName: 'Gift wrapping', quantity: 1 }],
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      assertNoManualLines(
        [productLine, manualLine],
        [{ isManual: true, manualName: 'Gift wrapping', quantity: 1 }],
      ),
    ).toThrow('Manual items cannot be returned or exchanged.');
  });

  it('rejects a request naming an original manual line (case-insensitive), even without the flag', () => {
    expect(() =>
      assertNoManualLines(
        [productLine, manualLine],
        [{ manualName: 'gift WRAPPING', quantity: 1 }],
      ),
    ).toThrow(/manual item/i);
  });

  it('rejects the raw staff-partial shape (no originals loaded yet)', () => {
    expect(() =>
      assertNoManualLines([], [{ isManual: true, quantity: 1 }]),
    ).toThrow(BadRequestException);
  });
});
