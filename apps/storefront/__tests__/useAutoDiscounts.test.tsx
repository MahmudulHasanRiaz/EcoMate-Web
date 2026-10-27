import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAutoDiscounts } from '@/hooks/useAutoDiscounts';
import { evaluateDiscounts } from '@/lib/api/orders';

vi.mock('@/lib/api/orders', () => ({ evaluateDiscounts: vi.fn() }));

const mockedEvaluate = vi.mocked(evaluateDiscounts);

/**
 * Combine-OFF regression: a coupon must REPLACE a non-combining auto
 * discount, never stack with it. The display bug was a stale pairing —
 * the previous evaluation's auto value shown next to the new coupon
 * (with the coupon % computed on the stale post-automatic base) — while
 * the re-evaluation for the new coupon was still pending, or after it
 * had failed silently. The hook therefore reports WHICH coupon its
 * result was evaluated with; callers gate the discount pair on it.
 */
describe('useAutoDiscounts coupon settlement', () => {
  const items = [
    {
      id: 'prod-hoodie',
      name: 'Mens WordPress Hoodie',
      price: 34.99,
      quantity: 2,
      variantId: 'var-large',
    },
  ] as any;

  const autoOnly = {
    autoDiscount: 10.5,
    byDiscount: [
      {
        discountId: 'd-v2',
        discountTitle: 'TEST-VERIFY V2 Discount',
        amount: 10.5,
      },
    ],
  };
  const suppressed = { autoDiscount: 0, byDiscount: [] };

  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('settles with no coupon and reports evaluatedCouponCode null', async () => {
    mockedEvaluate.mockResolvedValueOnce(autoOnly as any);
    const hook = renderHook(() => useAutoDiscounts(items));
    // Wait on the auto value, not evaluatedCouponCode: null is also the
    // initial state, so waiting on it would pass before the fetch lands.
    await waitFor(() =>
      expect(hook.result.current.autoDiscount).toBe(10.5),
    );
    expect(hook.result.current.evaluatedCouponCode).toBe(null);
    expect(hook.result.current.isEvaluating).toBe(false);
    expect(mockedEvaluate).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
  });

  it('does NOT present the stale auto value as current while the coupon evaluation is pending', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mockedEvaluate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = renderHook(
      ({ coupon }: { coupon?: string }) => useAutoDiscounts(items, coupon),
      { initialProps: { coupon: undefined as string | undefined } },
    );
    first.resolve(autoOnly);
    await waitFor(() =>
      expect(hook.result.current.autoDiscount).toBe(10.5),
    );
    expect(hook.result.current.evaluatedCouponCode).toBe(null);

    // Apply the coupon: the new evaluation is still in flight.
    hook.rerender({ coupon: 'TESTAUDIT10' });
    await waitFor(() =>
      expect(hook.result.current.isEvaluating).toBe(true),
    );
    // The stale auto value is still in state, but it is NOT current for
    // the new coupon — a caller gating on evaluatedCouponCode will not
    // pair it with the coupon line.
    expect(hook.result.current.evaluatedCouponCode).toBe(null);
    expect(mockedEvaluate).toHaveBeenLastCalledWith(
      expect.anything(),
      'TESTAUDIT10',
    );

    // The Combine-OFF evaluation settles: auto suppressed.
    second.resolve(suppressed);
    await waitFor(() =>
      expect(hook.result.current.evaluatedCouponCode).toBe('TESTAUDIT10'),
    );
    expect(hook.result.current.autoDiscount).toBe(0);
    expect(hook.result.current.byDiscount).toEqual([]);
    expect(hook.result.current.isEvaluating).toBe(false);
  });

  it('auto returns when the coupon is removed', async () => {
    mockedEvaluate
      .mockResolvedValueOnce(autoOnly as any)
      .mockResolvedValueOnce(suppressed as any)
      .mockResolvedValueOnce(autoOnly as any);
    const hook = renderHook(
      ({ coupon }: { coupon?: string }) => useAutoDiscounts(items, coupon),
      { initialProps: { coupon: undefined as string | undefined } },
    );
    await waitFor(() =>
      expect(hook.result.current.autoDiscount).toBe(10.5),
    );
    hook.rerender({ coupon: 'TESTAUDIT10' });
    await waitFor(() =>
      expect(hook.result.current.evaluatedCouponCode).toBe('TESTAUDIT10'),
    );
    expect(hook.result.current.autoDiscount).toBe(0);
    hook.rerender({ coupon: undefined });
    await waitFor(() =>
      expect(hook.result.current.evaluatedCouponCode).toBe(null),
    );
    expect(hook.result.current.autoDiscount).toBe(10.5);
  });

  it('a failed evaluation leaves evaluatedCouponCode stale and reports the error', async () => {
    mockedEvaluate
      .mockResolvedValueOnce(autoOnly as any)
      .mockRejectedValueOnce(new Error('boom'));
    const hook = renderHook(
      ({ coupon }: { coupon?: string }) => useAutoDiscounts(items, coupon),
      { initialProps: { coupon: undefined as string | undefined } },
    );
    await waitFor(() =>
      expect(hook.result.current.autoDiscount).toBe(10.5),
    );
    hook.rerender({ coupon: 'TESTAUDIT10' });
    await waitFor(() =>
      expect(hook.result.current.evaluateError).toBe(true),
    );
    expect(hook.result.current.isEvaluating).toBe(false);
    // Stale, not current: the caller must not pair the old auto value
    // with the new coupon.
    expect(hook.result.current.evaluatedCouponCode).toBe(null);
  });
});
