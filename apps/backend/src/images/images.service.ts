import { Injectable, Logger } from '@nestjs/common';
import { join, extname, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  private readonly uploadRoot = join(process.cwd(), 'uploads');
  private readonly cacheRoot = join(process.cwd(), '.cache', 'images');

  async resize(params: {
    path: string;
    w?: number;
    h?: number;
    q?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  }): Promise<{ buffer: Buffer; ext: string; mime: string }> {
    const sharp = (await import('sharp')).default;
    const isExternal =
      params.path.startsWith('http://') || params.path.startsWith('https://');

    if (!isExternal && params.path.includes('..')) {
      throw new Error('Invalid path');
    }

    if (!params.w && !params.h) {
      if (isExternal) {
        const buf = await this.downloadExternal(params.path);
        const mime = this.guessMimeFromUrl(params.path);
        return { buffer: buf, ext: '.jpg', mime };
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
      return {
        buffer: readFileSync(cachePath),
        ext: cacheExt,
        mime: 'image/webp',
      };
    }

    let sourceBuffer: Buffer;
    if (isExternal) {
      sourceBuffer = await this.downloadExternal(params.path);
    } else {
      sourceBuffer = this.readLocalFile(params.path).buffer;
    }

    let result: Buffer;
    try {
      result = await sharp(sourceBuffer)
        .resize({
          width: params.w,
          height: params.h,
          fit: params.fit || 'cover',
          withoutEnlargement: true,
        })
        .webp({ quality: params.q ?? 80 })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`sharp processing failed: ${(err as Error).message}`);
      const fallbackExt = extname(params.path.split('?')[0]).toLowerCase();
      const fallbackMimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
      };
      const fext = fallbackExt && fallbackMimeMap[fallbackExt] ? fallbackExt : '.jpg';
      return { buffer: sourceBuffer, ext: fext, mime: fallbackMimeMap[fext] || 'image/jpeg' };
    }

    try {
      mkdirSync(this.cacheRoot, { recursive: true });
      writeFileSync(cachePath, result);
    } catch (e) {
      this.logger.warn('Failed to cache resized image', e);
    }

    return { buffer: result, ext: cacheExt, mime: 'image/webp' };
  }

  private readLocalFile(path: string): { buffer: Buffer; ext: string; mime: string } {
    const relativePath = path.replace(/^\/uploads\//, '');
    const sourcePath = resolve(join(this.uploadRoot, relativePath));

    if (!sourcePath.startsWith(resolve(this.uploadRoot))) {
      throw new Error('Invalid path');
    }

    if (!existsSync(sourcePath)) {
      throw new Error(`Image not found: ${path}`);
    }

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
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

  private async downloadExternal(url: string): Promise<Buffer> {
    const cacheKey = createHash('md5').update(url).digest('hex');
    const originalCache = join(this.cacheRoot, `${cacheKey}_orig`);

    if (existsSync(originalCache)) {
      return readFileSync(originalCache);
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch external image: ${url} (${response.status})`);
        return this.generateFallback();
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      try {
        mkdirSync(this.cacheRoot, { recursive: true });
        writeFileSync(originalCache, buffer);
      } catch (e) {
        this.logger.warn('Failed to cache external image', e);
      }

      return buffer;
    } catch {
      this.logger.warn(`Failed to download external image: ${url}`);
      return this.generateFallback();
    }
  }

  private generateFallback(): Buffer {
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
  }

  private guessMimeFromUrl(url: string): string {
    const ext = extname(url.split('?')[0]).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.svg': 'image/svg+xml',
    };
    return map[ext] || 'image/jpeg';
  }
}
