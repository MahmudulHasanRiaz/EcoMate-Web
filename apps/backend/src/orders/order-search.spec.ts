import { buildOrderSearchFilter, phoneSpellings } from './order-search';

/**
 * The orders-list search accepts one input that may be an order number, a
 * customer/guest name, a phone number or a product SKU. These tests lock the
 * shape of the OR-set handed to Prisma — in particular that a complete phone
 * number is matched by EQUALITY (index-usable, exact) in every spelling, and
 * that a partial one degrades to a digits-only substring.
 */
describe('buildOrderSearchFilter', () => {
  const phoneFilters = (search: string) =>
    (buildOrderSearchFilter(search)?.OR ?? []).filter(
      (c: any) => c.customer?.phone || c.guestPhone,
    );

  it('returns undefined for a blank search so callers skip the OR entirely', () => {
    expect(buildOrderSearchFilter(undefined)).toBeUndefined();
    expect(buildOrderSearchFilter('')).toBeUndefined();
    expect(buildOrderSearchFilter('   ')).toBeUndefined();
  });

  it('always matches the order number, customer name and guest name as substrings', () => {
    const or = buildOrderSearchFilter('ORD-260929')!.OR;

    expect(or).toEqual(
      expect.arrayContaining([
        { displayId: { contains: 'ORD-260929', mode: 'insensitive' } },
        { customer: { name: { contains: 'ORD-260929', mode: 'insensitive' } } },
        { guestName: { contains: 'ORD-260929', mode: 'insensitive' } },
      ]),
    );
  });

  it('unwraps scanned QR code tracking URLs into the exact order number', () => {
    const orPath = buildOrderSearchFilter('https://store.example.com/orders/ORD-260930-0001')!.OR;
    expect(orPath).toEqual(
      expect.arrayContaining([
        { displayId: { contains: 'ORD-260930-0001', mode: 'insensitive' } },
      ]),
    );

    const orQuery = buildOrderSearchFilter('https://store.example.com/orders?id=ORD-260930-0002')!.OR;
    expect(orQuery).toEqual(
      expect.arrayContaining([
        { displayId: { contains: 'ORD-260930-0002', mode: 'insensitive' } },
      ]),
    );
  });

  it('matches a product or variant SKU through an EXISTS subquery, never a join', () => {
    const or = buildOrderSearchFilter('ECO-TSHIRT-M')!.OR;
    const sku = or.find((c: any) => c.items);

    // `some` keeps one order row per match no matter how many lines hit.
    expect(sku).toEqual({
      items: {
        some: {
          OR: [
            { variant: { sku: { contains: 'ECO-TSHIRT-M', mode: 'insensitive' } } },
            { product: { sku: { contains: 'ECO-TSHIRT-M', mode: 'insensitive' } } },
          ],
        },
      },
    });
  });

  describe('phone numbers', () => {
    const canonical = ['+8801712121213', '8801712121213', '01712121213', '1712121213'];

    it.each(canonical)(
      'matches %s by equality against every stored spelling',
      (input) => {
        expect(phoneFilters(input)).toEqual([
          { customer: { phone: { in: canonical } } },
          { guestPhone: { in: canonical } },
        ]);
      },
    );

    it('treats all four spellings of one number identically', () => {
      const shapes = canonical.map((input) =>
        JSON.stringify(phoneFilters(input)),
      );
      expect(new Set(shapes).size).toBe(1);
    });

    it('never falls back to a substring match for a complete number', () => {
      for (const input of canonical) {
        for (const filter of phoneFilters(input)) {
          expect(JSON.stringify(filter)).not.toContain('contains');
        }
      }
    });

    it('matches a half-typed number on its digit core, in either spelling', () => {
      // '0171' → core '171' hits both '01712121213' and '+8801712121213'.
      expect(phoneFilters('0171')).toEqual([
        { customer: { phone: { contains: '171' } } },
        { guestPhone: { contains: '171' } },
      ]);
    });

    it('ignores too-short digit runs and non-phone text', () => {
      expect(phoneFilters('01')).toEqual([]);
      expect(phoneFilters('ORD-260929')).toEqual([]);
    });
  });

  it('phoneSpellings derives national and bare forms from canonical E.164', () => {
    expect(phoneSpellings('+8801712121213')).toEqual([
      '+8801712121213',
      '8801712121213',
      '01712121213',
      '1712121213',
    ]);
  });
});
