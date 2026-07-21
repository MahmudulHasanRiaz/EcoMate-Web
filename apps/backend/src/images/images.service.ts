import { Injectable, Logger } from '@nestjs/common';
import { join, extname, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { SecureFetcher, validateImageBuffer } from './secure-fetcher';
import { defaultDns } from './ip-classifier';
import { defaultHttpTransport } from './secure-fetcher';

const FALLBACK_1x1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function extForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
  };
  return map[mime] || '.jpg';
}

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  private readonly uploadRoot = join(process.cwd(), 'uploads');
  private readonly cacheRoot = join(process.cwd(), '.cache', 'images');
  private readonly fetcher = new SecureFetcher(defaultDns, defaultHttpTransport);

  async resize(params: {
    path: string;
    w?: number;
    h?: number;
    q?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  }): Promise<{ buffer: Buffer; ext: string; mime: string }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const isExternal =
      params.path.startsWith('http://') || params.path.startsWith('https://');

    if (!isExternal && params.path.includes('..')) {
      throw new Error('Invalid path');
    }

    if (!params.w && !params.h) {
      // No resize — return as-is with MIME from detection
      if (isExternal) {
        const result = await this.downloadExternalWithFallback(params.path);
        return { buffer: result.buffer, ext: extForMime(result.mimeType), mime: result.mimeType };
      }
      const { buffer, ext, mime } = this.readLocalFile(params.path);
      return { buffer, ext, mime };
    }

    const cacheKey = createHash('md5')
      .update(
        `${params.path}:${params.w || ''}:${params.h || ''}:${params.q || 80}:${params.fit || 'cover'}`,
      )
      .digest('hex');
    const cacheExt = '.webp';
    const cachePath = join(this.cacheRoot, `${cacheKey}${cacheExt}`);

    if (existsSync(cachePath)) {
      const cached = readFileSync(cachePath);
      try {
        const validated = await validateImageBuffer(cached, 16_777_216);
        if (validated.mimeType !== 'image/webp') {
          throw new Error('Cached image is not WebP format');
        }
        return { buffer: validated.buffer, ext: cacheExt, mime: 'image/webp' };
      } catch {
        // Corrupt/wrong-format cache — delete and regenerate
        try { unlinkSync(cachePath); } catch { /* ignore */ }
        this.logger.warn('Deleted corrupt resized cache entry, regenerating');
      }
    }

    let sourceBuffer: Buffer;
    let sourceMime: string | null = null;
    if (isExternal) {
      const result = await this.downloadExternalWithFallback(params.path);
      sourceBuffer = result.buffer;
      sourceMime = result.mimeType;
    } else {
      const local = this.readLocalFile(params.path);
      sourceBuffer = local.buffer;
      sourceMime = local.mime;
    }

    try {
      const result = await sharp(sourceBuffer)
        .resize({
          width: params.w,
          height: params.h,
          fit: params.fit || 'cover',
          withoutEnlargement: true,
        })
        .webp({ quality: params.q ?? 80 })
        .toBuffer();

      try {
        mkdirSync(this.cacheRoot, { recursive: true });
        const tmpPath = cachePath + '.tmp.' + randomUUID();
        try {
          writeFileSync(tmpPath, result);
          renameSync(tmpPath, cachePath);
        } finally {
          // Best-effort cleanup of leftover temp file
          try { unlinkSync(tmpPath); } catch { /* temp already renamed or gone */ }
        }
      } catch (e) {
        this.logger.warn('Failed to cache resized image', e);
      }

      return { buffer: result, ext: cacheExt, mime: 'image/webp' };
    } catch (err) {
      this.logger.warn(`Sharp processing failed: ${(err as Error).message}`);
      // Fallback: return source with its detected MIME
      const fext = extForMime(sourceMime || 'image/jpeg');
      return {
        buffer: sourceBuffer,
        ext: fext,
        mime: sourceMime || 'image/jpeg',
      };
    }
  }

  private async downloadExternalWithFallback(
    url: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    // Check disk cache first
    const cacheKey = createHash('md5').update(url).digest('hex');
    const originalCache = join(this.cacheRoot, `${cacheKey}_orig`);

    if (existsSync(originalCache)) {
      const buf = readFileSync(originalCache);
      try {
        const validated = await validateImageBuffer(buf);
        return { buffer: validated.buffer, mimeType: validated.mimeType };
      } catch {
        // Corrupt cache — delete and refetch
        try { unlinkSync(originalCache); } catch { /* ignore */ }
        this.logger.warn('Deleted corrupt cache entry, refetching');
      }
    }

    try {
      const result = await this.fetcher.fetch(url);

      // Cache the successful download — atomic temp+rename
      try {
        mkdirSync(this.cacheRoot, { recursive: true });
        const tmpPath = originalCache + '.tmp.' + randomUUID();
        try {
          writeFileSync(tmpPath, result.buffer);
          renameSync(tmpPath, originalCache);
        } finally {
          try { unlinkSync(tmpPath); } catch { /* temp already renamed or gone */ }
        }
      } catch (e) {
        this.logger.warn('Failed to cache external image', e);
      }

      return { buffer: result.buffer, mimeType: result.mimeType };
    } catch (err) {
      // Preserve legacy behavior: fallback transparent 1x1 PNG on remote failure
      try {
        this.logger.warn(`Image fetch failed: ${new URL(url).hostname} — ${(err as Error).message}`);
      } catch {
        this.logger.warn(`Image fetch failed: invalid URL`);
      }
      return { buffer: FALLBACK_1x1_PNG, mimeType: 'image/png' };
    }
  }

  private readLocalFile(path: string): {
    buffer: Buffer;
    ext: string;
    mime: string;
  } {
    const relativePath = path.replace(/^\/uploads\//, '');
    const sourcePath = resolve(join(this.uploadRoot, relativePath));

    if (!sourcePath.startsWith(resolve(this.uploadRoot))) {
      throw new Error('Invalid path');
    }

    if (!existsSync(sourcePath)) {
      throw new Error(`Image not found: ${path}`);
    }

    const allowedExtensions = [
      '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif',
    ];
    const ext = extname(relativePath).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      throw new Error('Invalid file type');
    }

    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
    };

    return { buffer: readFileSync(sourcePath), ext, mime: mimeMap[ext] };
  }
}
