import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * B (owner-locked): GET /payments resolves `staff:<userId>` recordedBy tags to
 * `recorder: {id, firstName, lastName}` so the admin renders the shared user
 * chip (click → profile). The raw tag stays on the row for audit; customer /
 * gateway rows resolve to null and get no chip.
 */
describe('PaymentsService.findAll — recorder resolution (B)', () => {
  let service: PaymentsService;
  const mockPrisma: any = {
    payment: { findMany: jest.fn(), count: jest.fn() },
    userProfile: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('attaches recorder for staff rows, null for customer rows, keeps raw tags', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', recordedBy: 'staff:user-1' },
      { id: 'pay-2', recordedBy: 'staff:user-2' },
      { id: 'pay-3', recordedBy: null }, // customer / gateway row
    ]);
    mockPrisma.payment.count.mockResolvedValue(3);
    mockPrisma.userProfile.findMany.mockResolvedValue([
      { id: 'user-1', firstName: 'Rafi', lastName: 'Hossain' },
      { id: 'user-2', firstName: 'Mina', lastName: 'Akter' },
    ]);

    const result = await service.findAll({});

    // One batched lookup for the distinct staff ids — not N+1.
    expect(mockPrisma.userProfile.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userProfile.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-1', 'user-2'] } },
      select: { id: true, firstName: true, lastName: true },
    });

    expect(result.data[0]).toMatchObject({
      id: 'pay-1',
      recordedBy: 'staff:user-1',
      recorder: { id: 'user-1', firstName: 'Rafi', lastName: 'Hossain' },
    });
    expect(result.data[1].recorder).toMatchObject({ id: 'user-2' });
    expect(result.data[2]).toMatchObject({ id: 'pay-3', recorder: null });
  });

  it('deleted staff user → recorder null (raw tag still shown)', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', recordedBy: 'staff:ghost-user' },
    ]);
    mockPrisma.payment.count.mockResolvedValue(1);
    mockPrisma.userProfile.findMany.mockResolvedValue([]);

    const result = await service.findAll({});

    expect(result.data[0].recorder).toBeNull();
    expect(result.data[0].recordedBy).toBe('staff:ghost-user');
  });

  it('no staff tags → no user lookup at all', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', recordedBy: null },
    ]);
    mockPrisma.payment.count.mockResolvedValue(1);

    await service.findAll({});

    expect(mockPrisma.userProfile.findMany).not.toHaveBeenCalled();
  });
});
