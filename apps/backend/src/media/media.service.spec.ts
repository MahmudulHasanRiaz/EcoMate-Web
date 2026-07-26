import { Prisma } from '@prisma/client';
import { MediaService } from './media.service';

describe('MediaService derivative reprocessing', () => {
  const prisma = {
    media: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const storage = {};
  const mediaQueue = {
    deleteDerivatives: jest.fn(),
    schedule: jest.fn(),
  };

  let service: MediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.media.update.mockResolvedValue({});
    mediaQueue.deleteDerivatives.mockResolvedValue(undefined);
    mediaQueue.schedule.mockResolvedValue(undefined);
    service = new MediaService(
      prisma as any,
      storage as any,
      mediaQueue as any,
    );
  });

  it('clears the persisted derivative manifest before reprocessing one media item', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'media-1' });

    await service.reprocess('media-1');

    expect(prisma.media.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: expect.objectContaining({
        processingStatus: 'UPLOADED',
        processingError: null,
        derivativeManifest: Prisma.DbNull,
        blurUrl: null,
      }),
    });
    expect(mediaQueue.schedule).toHaveBeenCalledWith('media-1');
    expect(prisma.media.update.mock.invocationCallOrder[0]).toBeLessThan(
      mediaQueue.schedule.mock.invocationCallOrder[0],
    );
  });

  it('clears every failed item manifest before scheduling the batch', async () => {
    prisma.media.findMany.mockResolvedValue([
      { id: 'media-1' },
      { id: 'media-2' },
    ]);

    await expect(service.reprocessFailed(10)).resolves.toEqual({ queued: 2 });

    expect(prisma.media.update).toHaveBeenCalledTimes(2);
    for (const id of ['media-1', 'media-2']) {
      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id },
        data: expect.objectContaining({
          processingStatus: 'UPLOADED',
          processingError: null,
          derivativeManifest: Prisma.DbNull,
          blurUrl: null,
        }),
      });
      expect(mediaQueue.schedule).toHaveBeenCalledWith(id);
    }
  });
});
