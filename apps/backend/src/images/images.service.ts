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

    const relativePath = params.path.replace(/^\/uploads\//, '');

    if (relativePath.includes('..')) {
      throw new Error('Invalid path');
    }

    const sourcePath = resolve(join(this.uploadRoot, relativePath));

    if (!sourcePath.startsWith(resolve(this.uploadRoot))) {
      throw new Error('Invalid path');
    }

    if (!existsSync(sourcePath)) {
      throw new Error(`Image not found: ${params.path}`);
    }

    const allowedExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.avif',
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
    const mime = mimeMap[ext];

    if (!params.w && !params.h) {
      return { buffer: readFileSync(sourcePath), ext, mime };
    }

    const cacheKey = createHash('md5')
      .update(
        `${relativePath}:${params.w || ''}:${params.h || ''}:${params.q || 80}:${params.fit || 'cover'}`,
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

    const result = await sharp(sourcePath)
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
      writeFileSync(cachePath, result);
    } catch (e) {
      this.logger.warn('Failed to cache resized image', e);
    }

    return { buffer: result, ext: cacheExt, mime: 'image/webp' };
  }
}
