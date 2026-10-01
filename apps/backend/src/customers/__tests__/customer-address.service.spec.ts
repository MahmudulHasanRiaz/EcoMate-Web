import { Test } from '@nestjs/testing';
import { CustomerAddressService } from '../customer-address.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CustomerAddressService', () => {
  let service: CustomerAddressService;
  let tx: any;

  const ADDRESS_A = {
    fullName: 'Rahim Uddin',
    phone: '+8801711111111',
    addressLine: 'House 12, Road 5',
    area: 'Mirpur',
    thana: 'Mirpur Thana',
    district: 'Dhaka',
    postalCode: '1216',
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerAddressService,
        { provide: PrismaService, useValue: { customerAddress: {} } },
      ],
    }).compile();
    service = moduleRef.get(CustomerAddressService);

    // In-memory stand-in that honours the create-if-absent rule the service uses.
    const rows: any[] = [];
    tx = {
      customerAddress: {
        findFirst: jest.fn(async ({ where }: any) => {
          const hit = rows.find(
            (r) =>
              r.customerProfileId === where.customerProfileId &&
              r.type === where.type &&
              r.normalizedHash === where.normalizedHash,
          );
          return hit ? { id: hit.id, isDefault: hit.isDefault } : null;
        }),
        count: jest.fn(async ({ where }: any) =>
          rows.filter(
            (r) => r.customerProfileId === where.customerProfileId && r.type === where.type,
          ).length,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `addr-${rows.length + 1}`, ...data };
          rows.push(row);
          return row;
        }),
      },
    };
    (tx as any).__rows = rows;
  });

  it('is a no-op when there is no customer profile', async () => {
    const created = await service.syncFromOrder(tx, {
      customerProfileId: null,
      shippingAddress: ADDRESS_A,
      billingAddress: null,
      orderId: 'o1',
    });
    expect(created).toBe(0);
    expect(tx.customerAddress.create).not.toHaveBeenCalled();
  });

  it('seeds both roles on a first order with no separate billing address', async () => {
    const created = await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: ADDRESS_A,
      billingAddress: null,
      orderId: 'o1',
    });
    expect(created).toBe(2);
    const rows = (tx as any).__rows;
    expect(rows.map((r: any) => r.type).sort()).toEqual(['BILLING', 'SHIPPING']);
    // Identical contents, different roles — intentional, not a duplicate.
    expect(rows[0].normalizedHash).toBe(rows[1].normalizedHash);
  });

  it('seeds the two roles independently when billing WAS captured', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: ADDRESS_A,
      billingAddress: { ...ADDRESS_A, addressLine: 'Flat 9, Road 1' },
      orderId: 'o1',
    });
    const rows = (tx as any).__rows;
    const shipping = rows.find((r: any) => r.type === 'SHIPPING');
    const billing = rows.find((r: any) => r.type === 'BILLING');
    expect(shipping.addressLine).toBe('House 12, Road 5');
    expect(billing.addressLine).toBe('Flat 9, Road 1');
  });

  it('reuses the existing row for the same address and role', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o1',
    });
    const second = await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o2',
    });
    expect(second).toBe(0);
    expect((tx as any).__rows).toHaveLength(2); // still one per role
  });

  it('reuses when the address is written differently but normalises the same', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o1',
    });
    const second = await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: {
        ...ADDRESS_A,
        addressLine: 'house 12 road 5',
        thana: 'Mirpur Upazila',
      },
      billingAddress: null,
      orderId: 'o2',
    });
    expect(second).toBe(0);
    expect((tx as any).__rows).toHaveLength(2);
  });

  it('adds a NEW row when only the house/road differs, despite the same locality', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o1',
    });
    const second = await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: { ...ADDRESS_A, addressLine: 'House 99, Road 5' },
      billingAddress: null,
      orderId: 'o2',
    });
    expect(second).toBe(2); // shipping + billing role for the new address
    expect((tx as any).__rows).toHaveLength(4);
  });

  it('never deletes or replaces an earlier address', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o1',
    });
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: { ...ADDRESS_A, addressLine: 'House 99' },
      billingAddress: null,
      orderId: 'o2',
    });
    const rows = (tx as any).__rows;
    // The original address is still present and unmodified.
    expect(rows.some((r: any) => r.addressLine === 'House 12, Road 5')).toBe(true);
    expect(tx.customerAddress.create).toHaveBeenCalledTimes(4);
  });

  it('marks the first address of each role as default', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o1',
    });
    const rows = (tx as any).__rows;
    expect(rows.every((r: any) => r.isDefault === true)).toBe(true);
  });

  it('does not mark later addresses of the same role as default', async () => {
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1', shippingAddress: ADDRESS_A, billingAddress: null, orderId: 'o1',
    });
    await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: { ...ADDRESS_A, addressLine: 'House 99' },
      billingAddress: null,
      orderId: 'o2',
    });
    const shipping = (tx as any).__rows.filter((r: any) => r.type === 'SHIPPING');
    expect(shipping.find((r: any) => r.addressLine === 'House 12, Road 5').isDefault).toBe(true);
    expect(shipping.find((r: any) => r.addressLine === 'House 99').isDefault).toBe(false);
  });

  it('ignores an address blob with no address line', async () => {
    const created = await service.syncFromOrder(tx, {
      customerProfileId: 'c1',
      shippingAddress: { area: 'Mirpur', district: 'Dhaka' },
      billingAddress: null,
      orderId: 'o1',
    });
    expect(created).toBe(0);
  });
});
