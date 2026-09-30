import { BadRequestException } from '@nestjs/common';
import { DashboardQueryService } from '../services/dashboard-query.service';

/**
 * Retention policy lower bound: a configured 0 makes the purge cutoff "now"
 * and the next sweep deletes every non-override event of that category.
 */
describe('DashboardQueryService — retention policy bounds', () => {
  const prisma: any = {
    securityRetentionPolicy: { upsert: jest.fn() },
  };
  const service = new DashboardQueryService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('rejects retentionDays = 0 (would wipe the category on the next sweep)', async () => {
    await expect(
      service.updateRetentionPolicy('AUTH' as any, 'LOW' as any, { retentionDays: 0 }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.securityRetentionPolicy.upsert).not.toHaveBeenCalled();
  });

  it('rejects negative / non-integer retentionDays', async () => {
    await expect(
      service.updateRetentionPolicy('AUTH' as any, 'LOW' as any, { retentionDays: -5 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateRetentionPolicy('AUTH' as any, 'LOW' as any, { retentionDays: 3.5 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a criticalRetentionDays below 1 when provided', async () => {
    await expect(
      service.updateRetentionPolicy('BLOCK' as any, 'CRITICAL' as any, {
        retentionDays: 180,
        criticalRetentionDays: 0,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid policy and normalizes the values', async () => {
    prisma.securityRetentionPolicy.upsert.mockResolvedValue({
      id: 'pol-1',
      category: 'AUTH',
      severity: 'LOW',
      retentionDays: 30,
      criticalRetentionDays: null,
    });

    const res = await service.updateRetentionPolicy('AUTH' as any, 'LOW' as any, {
      retentionDays: 30,
    });

    expect(res.retentionDays).toBe(30);
    expect(prisma.securityRetentionPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ retentionDays: 30 }),
        update: expect.objectContaining({ retentionDays: 30 }),
      }),
    );
  });
});
