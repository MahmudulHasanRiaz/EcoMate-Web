import { BadRequestException, StreamableFile } from '@nestjs/common';
import { PosAnalyticsController } from '../pos-analytics.controller';

describe('PosAnalyticsController', () => {
  const svc = {
    getOverview: jest.fn().mockResolvedValue({ data: {}, meta: {} }),
    getTransactions: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    buildExport: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('x'), filename: 'POS-Sales-s-2026-09-01_2026-09-30.xlsx' }),
  };
  const ctl = new PosAnalyticsController(svc as any);
  const user = { userId: 'cash-A' };

  beforeEach(() => jest.clearAllMocks());

  it('rejects forged showroomId before touching the service', () => {
    expect(() =>
      ctl.overview('sess-1', user, { scope: 'showroom' } as any, 'sh-evil'),
    ).toThrow(BadRequestException);
    expect(svc.getOverview).not.toHaveBeenCalled();
  });

  it('passes session header + user through to the service', async () => {
    await ctl.transactions('sess-1', user, { scope: 'mine' } as any, undefined);
    expect(svc.getTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', userId: 'cash-A' }),
    );
  });

  it('serves the export as xlsx StreamableFile (Fastify-safe, no Express res)', async () => {
    const out = await ctl.export(
      'sess-1',
      user,
      { scope: 'showroom' } as any,
      undefined,
    );
    expect(svc.buildExport).toHaveBeenCalled();
    expect(out).toBeInstanceOf(StreamableFile);
    expect(out.getHeaders()).toEqual(
      expect.objectContaining({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition:
          'attachment; filename="POS-Sales-s-2026-09-01_2026-09-30.xlsx"',
      }),
    );
  });
});
