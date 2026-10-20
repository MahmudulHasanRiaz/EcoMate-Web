import { deriveOrderDue } from '../order-due';

const paid = (amount: number | string, over: Record<string, unknown> = {}) => ({
  amount,
  status: 'PAID',
  gatewayCode: 'bkash',
  ...over,
});

describe('deriveOrderDue', () => {
  it('subtracts PAID payments and received returns from the total', () => {
    const r = deriveOrderDue({
      total: 1000,
      payments: [paid(400)],
      receivedReturnValue: 300,
    });
    expect(r).toEqual({ paid: 400, credit: 0, receivedReturnValue: 300, due: 300 });
  });

  it('adds applied customer credit to the deduction', () => {
    const r = deriveOrderDue({
      total: 1000,
      payments: [paid(500, { appliedCreditAmount: 200 })],
    });
    expect(r.credit).toBe(200);
    expect(r.due).toBe(300);
  });

  it('excludes courier-settlement rows (they are not customer payments)', () => {
    const r = deriveOrderDue({
      total: 1000,
      payments: [
        paid(300),
        paid(500, { gatewayCode: 'courier_settlement' }),
      ],
    });
    expect(r.paid).toBe(300);
    expect(r.due).toBe(700);
  });

  it('ignores non-PAID rows entirely (including their credit)', () => {
    const r = deriveOrderDue({
      total: 1000,
      payments: [
        paid(100),
        { amount: 900, status: 'FAILED', gatewayCode: 'bkash', appliedCreditAmount: 500 },
        { amount: 900, status: 'PAID', gatewayCode: 'bkash', appliedCreditAmount: 0 },
      ],
    });
    expect(r.paid).toBe(1000);
    expect(r.credit).toBe(0);
    expect(r.due).toBe(0);
  });

  it('never goes negative', () => {
    const r = deriveOrderDue({
      total: 1000,
      payments: [paid(900)],
      receivedReturnValue: 300,
    });
    expect(r.due).toBe(0);
  });

  it('zeroes due for a cancelled order but still reports payments', () => {
    const r = deriveOrderDue({
      total: 1000,
      payments: [paid(200)],
      cancelled: true,
    });
    expect(r.paid).toBe(200);
    expect(r.due).toBe(0);
  });

  it('tolerates missing/string money fields', () => {
    const r = deriveOrderDue({ total: '1000.50', payments: [paid('0.50')] });
    expect(r.due).toBe(1000);
  });
});
