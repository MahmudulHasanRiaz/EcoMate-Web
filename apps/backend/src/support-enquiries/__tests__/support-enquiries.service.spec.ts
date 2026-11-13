import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupportEnquiriesService } from '../support-enquiries.service';

describe('SupportEnquiriesService', () => {
  function mockPrisma() {
    return {
      supportEnquiry: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'enq-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
          id: where.id,
          ...data,
        })),
      },
    };
  }

  const baseDto = {
    name: 'Ayesha Khan',
    email: 'ayesha@example.com',
    phone: '+8801711111111',
    subject: 'Late delivery',
    message: 'My order has not arrived yet.',
    orderId: 'ORD-1',
  };

  it('creates an enquiry with status NEW', async () => {
    const prisma = mockPrisma();
    const svc = new SupportEnquiriesService(prisma as any);
    const created = await svc.create(baseDto);
    expect(prisma.supportEnquiry.create).toHaveBeenCalledWith({
      data: {
        name: 'Ayesha Khan',
        email: 'ayesha@example.com',
        phone: '+8801711111111',
        subject: 'Late delivery',
        message: 'My order has not arrived yet.',
        orderId: 'ORD-1',
        status: 'NEW',
      },
    });
    expect((created as any).status).toBe('NEW');
  });

  it('stores nulls for missing optional contact fields', async () => {
    const prisma = mockPrisma();
    const svc = new SupportEnquiriesService(prisma as any);
    await svc.create({ name: 'Rahim', message: 'Hello' });
    expect(prisma.supportEnquiry.create).toHaveBeenCalledWith({
      data: {
        name: 'Rahim',
        email: null,
        phone: null,
        subject: null,
        message: 'Hello',
        orderId: null,
        status: 'NEW',
      },
    });
  });

  it('honeypot: a filled website field is accepted but stores nothing', async () => {
    const prisma = mockPrisma();
    const svc = new SupportEnquiriesService(prisma as any);
    const res = await svc.create({ ...baseDto, website: 'http://spam.example' });
    expect(res).toEqual({ received: true });
    expect(prisma.supportEnquiry.create).not.toHaveBeenCalled();
  });

  it('lists with the status filter and pagination envelope', async () => {
    const prisma = mockPrisma();
    prisma.supportEnquiry.findMany.mockResolvedValue([{ id: 'e1' }]);
    prisma.supportEnquiry.count.mockResolvedValue(1);
    const svc = new SupportEnquiriesService(prisma as any);
    const res = await svc.findAll({ status: 'NEW', page: 2, perPage: 10 });
    expect(prisma.supportEnquiry.findMany).toHaveBeenCalledWith({
      where: { status: 'NEW' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(res.meta).toEqual({ total: 1, page: 2, perPage: 10, totalPages: 1 });
  });

  it('rejects an unknown status filter', async () => {
    const prisma = mockPrisma();
    const svc = new SupportEnquiriesService(prisma as any);
    await expect(svc.findAll({ status: 'ESCALATED' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.supportEnquiry.findMany).not.toHaveBeenCalled();
  });

  it('findOne throws 404 for an unknown id', async () => {
    const prisma = mockPrisma();
    prisma.supportEnquiry.findUnique.mockResolvedValue(null);
    const svc = new SupportEnquiriesService(prisma as any);
    await expect(svc.findOne('nope')).rejects.toThrow(NotFoundException);
  });

  it('marking REPLIED stamps repliedById/repliedAt', async () => {
    const prisma = mockPrisma();
    prisma.supportEnquiry.findUnique.mockResolvedValue({ id: 'e1', status: 'NEW' });
    const svc = new SupportEnquiriesService(prisma as any);
    const before = Date.now();
    const updated = await svc.updateStatus('e1', 'REPLIED', 'user-9');
    expect(prisma.supportEnquiry.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ status: 'REPLIED', repliedById: 'user-9' }),
    });
    const stamped = (updated as any).repliedAt as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('reopening to NEW clears the reply stamps', async () => {
    const prisma = mockPrisma();
    prisma.supportEnquiry.findUnique.mockResolvedValue({ id: 'e1', status: 'REPLIED' });
    const svc = new SupportEnquiriesService(prisma as any);
    await svc.updateStatus('e1', 'NEW', 'user-9');
    expect(prisma.supportEnquiry.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'NEW', repliedById: null, repliedAt: null },
    });
  });

  it('updateStatus throws 404 for an unknown id', async () => {
    const prisma = mockPrisma();
    prisma.supportEnquiry.findUnique.mockResolvedValue(null);
    const svc = new SupportEnquiriesService(prisma as any);
    await expect(svc.updateStatus('nope', 'REPLIED', 'u1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.supportEnquiry.update).not.toHaveBeenCalled();
  });
});
