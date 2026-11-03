import { MediaQueueService } from '../media-queue.service';

/**
 * backfillMissingDerivatives: READY image rows with no usable manifest
 * (null/empty) must be queued for the 'process' job; rows that already
 * carry WebP derivatives must be left alone; dry-run queues nothing.
 */
describe('MediaQueueService.backfillMissingDerivatives', () => {
  const rows = [
    { id: 'a-null-manifest', derivativeManifest: null },
    { id: 'b-has-webp', derivativeManifest: { small: '/d/b/small.webp' } },
    { id: 'c-empty-manifest', derivativeManifest: {} },
    { id: 'd-avif-only', derivativeManifest: { small_avif: '/d/d/small.avif' } },
  ];

  function makeService() {
    const prisma = {
      media: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(rows)
          .mockResolvedValue([]),
      },
    };
    const queue = { add: jest.fn() };
    const service = new MediaQueueService(
      queue as any,
      prisma as any,
      {} as any,
      {} as any,
    );
    const scheduleSpy = jest
      .spyOn(service, 'schedule')
      .mockResolvedValue(undefined);
    return { service, scheduleSpy, prisma };
  }

  it('queues only manifest-less READY images, at low priority', async () => {
    const { service, scheduleSpy } = makeService();

    const result = await service.backfillMissingDerivatives();

    expect(result).toEqual({ scanned: 4, missing: 3, queued: 3 });
    expect(scheduleSpy.mock.calls).toEqual([
      ['a-null-manifest', { priority: 100 }],
      ['c-empty-manifest', { priority: 100 }],
      ['d-avif-only', { priority: 100 }],
    ]);
  });

  it('dry-run counts the missing rows but queues nothing', async () => {
    const { service, scheduleSpy } = makeService();

    const result = await service.backfillMissingDerivatives({ dryRun: true });

    expect(result).toEqual({ scanned: 4, missing: 3, queued: 0 });
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it('scans READY image media only', async () => {
    const { service, prisma } = makeService();

    await service.backfillMissingDerivatives();

    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          processingStatus: 'READY',
          mimeType: { startsWith: 'image/' },
        },
      }),
    );
  });
});
