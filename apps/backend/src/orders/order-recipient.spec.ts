import {
  orderRecipientName,
  orderRecipientPhone,
  orderRecipientEmail,
  orderSnapshotCustomer,
} from './order-recipient';

describe('orderRecipientName', () => {
  it('joins snapshot first + last name', () => {
    expect(
      orderRecipientName({ customerFirstName: 'MR', customerLastName: 'Joy' }),
    ).toBe('MR Joy');
  });

  it('falls back to guestName when snapshot names are empty', () => {
    expect(
      orderRecipientName({
        customerFirstName: null,
        customerLastName: null,
        guestName: 'Guest User',
      }),
    ).toBe('Guest User');
  });

  it("falls back to 'Customer' when nothing is set", () => {
    expect(orderRecipientName({})).toBe('Customer');
  });

  it("floors short names to 'Customer' (Pathao requires ≥3 chars)", () => {
    expect(
      orderRecipientName({
        customerFirstName: 'MR',
        customerLastName: null,
        guestName: null,
      }),
    ).toBe('Customer');
  });

  it('keeps a name of exactly 3 chars', () => {
    expect(
      orderRecipientName({ customerFirstName: 'Joy', customerLastName: null }),
    ).toBe('Joy');
  });
});

describe('orderRecipientPhone', () => {
  it('prefers customerPhone over guestPhone', () => {
    expect(
      orderRecipientPhone({
        customerPhone: '01712345678',
        guestPhone: '01999999999',
      }),
    ).toBe('01712345678');
  });

  it('falls back to guestPhone', () => {
    expect(
      orderRecipientPhone({ customerPhone: null, guestPhone: '01999999999' }),
    ).toBe('01999999999');
  });

  it('returns undefined when neither is set', () => {
    expect(orderRecipientPhone({})).toBeUndefined();
  });
});

describe('orderRecipientEmail', () => {
  it('returns customerEmail', () => {
    expect(
      orderRecipientEmail({ customerEmail: 'mr.joy@example.com' }),
    ).toBe('mr.joy@example.com');
  });

  it('returns undefined when absent', () => {
    expect(orderRecipientEmail({})).toBeUndefined();
  });
});

describe('orderSnapshotCustomer', () => {
  it('builds the legacy-keyed object from snapshot fields', () => {
    expect(
      orderSnapshotCustomer({
        customerId: 'cust-1',
        customerFirstName: 'MR',
        customerLastName: 'Joy',
        customerPhone: '01712345678',
        customerEmail: 'mr.joy@example.com',
      }),
    ).toEqual({
      id: 'cust-1',
      name: 'MR Joy',
      email: 'mr.joy@example.com',
      phone: '01712345678',
      firstName: 'MR',
      lastName: 'Joy',
      phoneNumber: '01712345678',
    });
  });

  it('falls back to guest fields when the snapshot is empty', () => {
    expect(
      orderSnapshotCustomer({
        customerId: null,
        guestName: 'Guest User',
        guestPhone: '01999999999',
      }),
    ).toMatchObject({ id: null, name: 'Guest User', phone: '01999999999' });
  });

  it('returns null when the order carries no identity at all', () => {
    expect(orderSnapshotCustomer({})).toBeNull();
  });
});
