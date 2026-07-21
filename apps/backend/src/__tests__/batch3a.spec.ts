import { Logger } from '@nestjs/common';
import { PageViewBufferService } from '../tracking/page-view-buffer.service';
import { MediaQueueProcessor } from '../media/media-queue/media-queue.processor';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaQueueService } from '../media/media-queue/media-queue.service';
import { Job } from 'bullmq';

/* ═══════════════════════════════════════════════
   PageViewBufferService — single-flight flush
   ═══════════════════════════════════════════════ */

describe('PageViewBufferService', () => {
  let svc: PageViewBufferService;
  let createMany: jest.Mock;
  let prisma: { pageView: { createMany: jest.Mock } };

  function makeEntry(overrides?: Partial<Record<string, unknown>>) {
    return {
      url: '/test',
      referrer: null,
      source: null,
      userAgent: 'test',
      ip: '127.0.0.1',
      sessionId: null,
      timestamp: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    createMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma = { pageView: { createMany } };
    svc = new PageViewBufferService(prisma as unknown as PrismaService);
    clearInterval((svc as any).flushTimer);
    (svc as any).flushTimer = null as any;
  });

  afterEach(async () => {
    if ((svc as any).flushTimer) clearInterval((svc as any).flushTimer);
    if ((svc as any).activeFlush) {
      try { await (svc as any).activeFlush; } catch { /* ignore */ }
    }
  });

  /* ── 1. Success ── */

  it('successful flush drains buffer and calls createMany with entries', async () => {
    svc.push(makeEntry());
    svc.push(makeEntry());
    await (svc as any).flush();

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.anything(), expect.anything()]),
        skipDuplicates: true,
      }),
    );
    expect((svc as any).buffer.length).toBe(0);
  });

  /* ── 2. Failure requeues, retry sends correct order ── */

  it('failed flush requeues batch at front ahead of newer entries; retry sends [a,b,c]', async () => {
    createMany.mockRejectedValueOnce(new Error('DB down'));
    svc.push(makeEntry({ url: '/a' }));
    svc.push(makeEntry({ url: '/b' }));

    await expect((svc as any).flush()).rejects.toThrow('DB down');
    expect((svc as any).buffer.length).toBe(2);
    expect((svc as any).buffer[0].url).toBe('/a');
    expect((svc as any).buffer[1].url).toBe('/b');

    svc.push(makeEntry({ url: '/c' }));
    expect((svc as any).buffer[2].url).toBe('/c');

    createMany.mockResolvedValueOnce({ count: 3 });
    await (svc as any).flush();
    expect(createMany).toHaveBeenCalledTimes(2);
    // Assert second call sends data in correct order
    const secondCallData = createMany.mock.calls[1][0].data;
    expect(secondCallData.map((e: any) => e.url)).toEqual(['/a', '/b', '/c']);
    expect((svc as any).buffer.length).toBe(0);
  });

  /* ── 3. Single-flight ── */

  it('concurrent flush calls share one createMany operation', async () => {
    let resolveFlush: (v: unknown) => void;
    createMany.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFlush = resolve; }),
    );
    svc.push(makeEntry());

    const flush1 = (svc as any).flush();
    const flush2 = (svc as any).flush();

    resolveFlush!({ count: 1 });
    await flush1;
    await flush2;

    expect(createMany).toHaveBeenCalledTimes(1);
  });

  /* ── 4. Entries during in-flight ── */

  it('entries pushed during in-flight flush remain in buffer for subsequent flush', async () => {
    let resolveFlush: (v: unknown) => void;
    createMany.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFlush = resolve; }),
    );

    svc.push(makeEntry({ url: '/a' }));
    const flushPromise = (svc as any).flush();

    svc.push(makeEntry({ url: '/b' }));
    expect((svc as any).buffer.length).toBe(1);
    expect((svc as any).buffer[0].url).toBe('/b');

    resolveFlush!({ count: 1 });
    await flushPromise;

    expect((svc as any).buffer.length).toBe(1);
    expect((svc as any).buffer[0].url).toBe('/b');

    await (svc as any).flush();
    expect(createMany).toHaveBeenCalledTimes(2);
    expect((svc as any).buffer.length).toBe(0);
  });

  /* ── 5. Failure resets activeFlush ── */

  it('failure clears activeFlush and subsequent flush can retry', async () => {
    createMany.mockRejectedValueOnce(new Error('transient error'));
    svc.push(makeEntry({ url: '/retry-me' }));

    await expect((svc as any).flush()).rejects.toThrow('transient error');
    expect((svc as any).activeFlush).toBeNull();
    expect((svc as any).buffer.length).toBe(1);

    createMany.mockResolvedValueOnce({ count: 1 });
    await (svc as any).flush();
    expect(createMany).toHaveBeenCalledTimes(2);
    expect((svc as any).buffer.length).toBe(0);
  });

  /* ── 6. Destroy drains ── */

  it('onModuleDestroy awaits active flush then drains remaining', async () => {
    let resolveFlush: (v: unknown) => void;
    createMany.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFlush = resolve; }),
    );

    svc.push(makeEntry({ url: '/a' }));
    (svc as any).flush();
    svc.push(makeEntry({ url: '/b' }));

    const destroyPromise = svc.onModuleDestroy();
    resolveFlush!({ count: 1 });
    await destroyPromise;

    expect(createMany).toHaveBeenCalledTimes(2);
    expect((svc as any).buffer.length).toBe(0);
  });

  /* ── 7. Persistent failure bounded ── */

  it('persistent failure on destroy is bounded and retains buffer with exact count logged', async () => {
    const errorSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => {});
    createMany.mockRejectedValue(new Error('permanent failure'));
    svc.push(makeEntry({ url: '/stuck' }));

    await svc.onModuleDestroy();

    expect((svc as any).buffer.length).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to flush 1 page views during shutdown — data retained in memory',
    );
    errorSpy.mockRestore();
  });
});

/* ═══════════════════════════════════════════════
   MediaQueueProcessor — error rethrow + recovery
   ═══════════════════════════════════════════════ */

function createMockSharp() {
  const chain = {
    metadata: jest.fn().mockResolvedValue({ format: 'jpeg', width: 100, height: 100 }),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-buffer')),
  };
  return jest.fn(() => chain);
}

describe('MediaQueueProcessor', () => {
  let processor: MediaQueueProcessor;
  let prisma: { media: { findUnique: jest.Mock; update: jest.Mock } };
  let storage: { read: jest.Mock; store: jest.Mock };
  let mediaQueue: { recoverStuck: jest.Mock };
  let mockSharpFn: jest.Mock;

  const sampleMedia = { id: 'media-1', mimeType: 'image/jpeg', filename: 'uploads/test.jpg' };

  function makeJob(data?: Record<string, unknown>): Job {
    return { name: 'process', data: { mediaId: 'media-1', ...data } } as unknown as Job;
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    mockSharpFn = createMockSharp();
    jest.spyOn(MediaQueueProcessor.prototype as any, 'loadSharp').mockResolvedValue(mockSharpFn);
    prisma = {
      media: {
        findUnique: jest.fn().mockResolvedValue(sampleMedia),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    storage = {
      read: jest.fn().mockResolvedValue(Buffer.from('image-data')),
      store: jest.fn().mockResolvedValue('https://cdn.test/url'),
    };
    mediaQueue = { recoverStuck: jest.fn() };
    processor = new MediaQueueProcessor(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      mediaQueue as unknown as MediaQueueService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* ── 1. Processing failure → FAILED + original error identity ── */

  it('processing failure updates FAILED status and rethrows original Error by identity', async () => {
    const originalError = new Error('disk full');
    storage.read.mockRejectedValue(originalError);

    await expect(processor.process(makeJob())).rejects.toBe(originalError);

    const failedUpdates = prisma.media.update.mock.calls.filter(
      (call: unknown[]) => (call[0] as any).data?.processingStatus === 'FAILED',
    );
    expect(failedUpdates.length).toBe(1);
    expect(failedUpdates[0][0]).toMatchObject({
      where: { id: 'media-1' },
      data: expect.objectContaining({ processingStatus: 'FAILED', processingError: 'disk full' }),
    });
  });

  /* ── 2. Secondary FAILED-update failure ── */

  it('secondary FAILED-update failure logs error but still rethrows original', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const originalError = new Error('disk full');
    storage.read.mockRejectedValue(originalError);
    prisma.media.update
      .mockResolvedValueOnce({})                         // PROCESSING
      .mockRejectedValueOnce(new Error('DB write failed')); // FAILED

    await expect(processor.process(makeJob())).rejects.toBe(originalError);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DB write failed'));
    errorSpy.mockRestore();
  });

  /* ── 3. Successful path ── */

  it('successful processing resolves with expected PROCESSING→READY updates', async () => {
    await processor.process(makeJob());

    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1' },
        data: expect.objectContaining({ processingStatus: 'PROCESSING' }),
      }),
    );
    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1' },
        data: expect.objectContaining({
          processingStatus: 'READY',
          derivativeManifest: expect.objectContaining({
            thumbnail: expect.any(String),
            small: expect.any(String),
            medium: expect.any(String),
            large: expect.any(String),
          }),
        }),
      }),
    );
  });

  /* ── Non-image pass-through ── */

  it('non-image media is marked READY without processing derivatives', async () => {
    prisma.media.findUnique.mockResolvedValue({ ...sampleMedia, mimeType: 'application/pdf' });

    await processor.process(makeJob());

    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1' },
        data: { processingStatus: 'READY' },
      }),
    );
    expect(prisma.media.update).toHaveBeenCalledTimes(1);
  });
});
