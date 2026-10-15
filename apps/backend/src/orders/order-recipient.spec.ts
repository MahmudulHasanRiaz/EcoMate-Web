import {
  orderRecipientName,
  orderRecipientPhone,
  orderRecipientEmail,
  orderSnapshotCustomer,
  courierSafeRecipientName,
  orderRecipientRawName,
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

describe('courierSafeRecipientName (Fix 5a — Mx. prefix, per-courier rules)', () => {
  it("prefixes a short Pathao name with 'Mx. ' (grapheme count)", () => {
    // Founding incident: 'জয়' is 3 UTF-16 units but 2 grapheme clusters —
    // Pathao counts user-perceived characters, so it must get the Mx. prefix.
    expect(
      courierSafeRecipientName(
        { customerFirstName: 'জয়', customerLastName: '' },
        'pathao',
      ),
    ).toBe('Mx. জয়');
    expect(
      courierSafeRecipientName({ customerFirstName: 'জ' }, 'pathao'),
    ).toBe('Mx. জ');
    expect(courierSafeRecipientName({ guestName: 'Jo' }, 'pathao')).toBe(
      'Mx. Jo',
    );
  });

  it('truncates by grapheme clusters without splitting them', () => {
    const cluster = '👨‍👩‍👧‍👦'; // 1 grapheme, many UTF-16 units
    const long = { guestName: cluster.repeat(150) };
    const out = courierSafeRecipientName(long, 'pathao');
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const count = [...seg.segment(out)].length;
    expect(count).toBeLessThanOrEqual(100);
    expect(out).toBe(cluster.repeat(100));
  });

  it('exempts Carrybee from the Mx. prefix (verbatim short name)', () => {
    expect(
      courierSafeRecipientName(
        { customerFirstName: 'J', customerLastName: '' },
        'carrybee',
      ),
    ).toBe('J');
  });

  it('truncates a Pathao name longer than 100 chars', () => {
    const long101 = { customerFirstName: 'A'.repeat(101) };
    expect(courierSafeRecipientName(long101, 'pathao').length).toBeLessThanOrEqual(
      100,
    );
  });

  it('never mutates the stored order object', () => {
    const storedOrder = Object.freeze({
      customerFirstName: 'জয়',
      customerLastName: '',
    } as const);
    const snapshot = JSON.parse(JSON.stringify(storedOrder));
    courierSafeRecipientName(storedOrder, 'pathao');
    expect(storedOrder.customerFirstName).toBe('জয়');
    expect(JSON.parse(JSON.stringify(storedOrder))).toEqual(snapshot);
  });

  it('returns empty string for a missing name (caller surfaces field error, never prefixed)', () => {
    expect(courierSafeRecipientName({}, 'pathao')).toBe('');
    expect(
      courierSafeRecipientName(
        { customerFirstName: ' ', customerLastName: '', guestName: '  ' },
        'steadfast',
      ),
    ).toBe('');
  });

  it('sends short Steadfast names verbatim (no documented minimum — truncate to 100 only)', () => {
    expect(
      courierSafeRecipientName({ customerFirstName: 'Al' }, 'steadfast'),
    ).toBe('Al');
  });

  it('sends short RedX names verbatim and truncates long ones (no documented lengths — 100 default max, noted)', () => {
    expect(courierSafeRecipientName({ guestName: 'Bo' }, 'redx')).toBe('Bo');
    expect(
      courierSafeRecipientName({ guestName: 'B'.repeat(150) }, 'redx').length,
    ).toBeLessThanOrEqual(100);
  });

  it('truncates Carrybee names to 99 graphemes without ever prefixing', () => {
    expect(
      courierSafeRecipientName({ guestName: 'C'.repeat(120) }, 'carrybee')
        .length,
    ).toBeLessThanOrEqual(99);
    expect(
      courierSafeRecipientName({ guestName: 'C'.repeat(120) }, 'carrybee'),
    ).not.toContain('Mx.');
    // Grapheme-based 99-cut: 150 single-grapheme emoji clusters → 99 intact.
    const cluster = '👨‍👩‍👧‍👦';
    const out = courierSafeRecipientName(
      { guestName: cluster.repeat(150) },
      'carrybee',
    );
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    expect([...seg.segment(out)].length).toBe(99);
    expect(out).toBe(cluster.repeat(99));
  });

  it('leaves names within range untouched and trims whitespace', () => {
    expect(
      courierSafeRecipientName(
        { customerFirstName: 'MR', customerLastName: 'Joy' },
        'pathao',
      ),
    ).toBe('MR Joy');
    expect(courierSafeRecipientName({ guestName: 'Joy' }, 'pathao')).toBe(
      'Joy',
    );
    expect(courierSafeRecipientName({ guestName: '  Jo  ' }, 'pathao')).toBe(
      'Mx. Jo',
    );
  });

  it('treats the courier key case-insensitively; only Pathao prepends, unknown couriers go verbatim (100 default max)', () => {
    expect(courierSafeRecipientName({ guestName: 'Jo' }, 'Pathao')).toBe(
      'Mx. Jo',
    );
    expect(courierSafeRecipientName({ guestName: 'Jo' }, 'mystery')).toBe(
      'Jo',
    );
  });

  it('exposes the raw untransformed snapshot name for timeline comparison', () => {
    expect(
      orderRecipientRawName({ customerFirstName: 'জয়', customerLastName: '' }),
    ).toBe('জয়');
    expect(orderRecipientRawName({})).toBe('');
  });
});
