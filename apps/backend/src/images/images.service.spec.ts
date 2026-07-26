import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExternalImageFetchError, ImagesService } from './images.service';
import { validateImageBuffer } from './secure-fetcher';

describe('ImagesService cache and upstream failure behavior', () => {
  let tempRoot: string;
  let cacheRoot: string;
  let sourcePng: Buffer;
  let alternatePng: Buffer;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    sourcePng = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    alternatePng = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ecomate-images-'));
    cacheRoot = join(tempRoot, 'cache');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function createService(fetch: jest.Mock): ImagesService {
    const service = new ImagesService();
    (service as any).uploadRoot = join(tempRoot, 'uploads');
    (service as any).cacheRoot = cacheRoot;
    (service as any).fetcher = { fetch };
    return service;
  }

  it('throws on an upstream failure instead of returning a successful 1x1 image', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('origin unavailable'));
    const service = createService(fetch);

    await expect(
      service.resize({ path: 'https://cdn.example.com/product.png' }),
    ).rejects.toBeInstanceOf(ExternalImageFetchError);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(existsSync(cacheRoot)).toBe(false);
  });

  it('discards a cached legacy 1x1 resize and regenerates it from the source', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const fetch = jest.fn().mockResolvedValue({
      buffer: sourcePng,
      mimeType: 'image/png',
    });
    const service = createService(fetch);
    mkdirSync(cacheRoot, { recursive: true });

    const url = 'https://cdn.example.com/product.png';
    const cacheKey = createHash('md5')
      .update(`${url}:100:100:80:cover`)
      .digest('hex');
    const resizedCache = join(cacheRoot, `${cacheKey}.webp`);
    const legacyFallbackPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const legacyFallback = await sharp(legacyFallbackPng)
      .webp({ quality: 80 })
      .toBuffer();
    writeFileSync(resizedCache, legacyFallback);

    const result = await service.resize({ path: url, w: 100, h: 100 });
    const metadata = await sharp(result.buffer).metadata();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(metadata.width).toBe(4);
    expect(metadata.height).toBe(4);
    expect(
      (await validateImageBuffer(readFileSync(resizedCache))).mimeType,
    ).toBe('image/webp');
  });

  it('uses the media version to invalidate both original and resized caches', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ buffer: sourcePng, mimeType: 'image/png' })
      .mockResolvedValueOnce({ buffer: alternatePng, mimeType: 'image/png' });
    const service = createService(fetch);
    const url = 'https://cdn.example.com/versioned-product.png';

    const first = await service.resize({ path: url, version: 'v1' });
    const second = await service.resize({ path: url, version: 'v2' });
    const firstAgain = await service.resize({ path: url, version: 'v1' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first.buffer.equals(second.buffer)).toBe(false);
    expect(firstAgain.buffer.equals(first.buffer)).toBe(true);
  });

  it('refetches an unversioned external original after the browser cache window', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ buffer: sourcePng, mimeType: 'image/png' })
      .mockResolvedValueOnce({ buffer: alternatePng, mimeType: 'image/png' });
    const service = createService(fetch);
    const url = 'https://cdn.example.com/unversioned-product.png';

    const first = await service.resize({ path: url });
    const originalCache = join(
      cacheRoot,
      `${createHash('md5').update(url).digest('hex')}_orig`,
    );
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(originalCache, oldDate, oldDate);
    const second = await service.resize({ path: url });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first.buffer.equals(second.buffer)).toBe(false);
  });
});
