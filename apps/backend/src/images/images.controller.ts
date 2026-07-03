import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ImagesService } from './images.service';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('images')
export class ImagesController {
  private readonly logger = new Logger(ImagesController.name);
  /** Dedup concurrent resize requests for identical params */
  private inflight = new Map<
    string,
    Promise<{ buffer: Buffer; ext: string; mime: string }>
  >();

  constructor(private readonly imagesService: ImagesService) {}

  private cacheKey(
    path: string,
    w?: string,
    h?: string,
    q?: string,
    fit?: string,
  ): string {
    return `${path}:${w || ''}:${h || ''}:${q || ''}:${fit || ''}`;
  }

  @Get('resize')
  async resize(
    @Res() res: FastifyReply,
    @Query('path') path: string,
    @Query('w') w?: string,
    @Query('h') h?: string,
    @Query('q') q?: string,
    @Query('fit') fit?: string,
  ) {
    if (!path) {
      return res.status(400).send({ error: 'path parameter is required' });
    }

    if (path.includes('..')) {
      return res.status(400).send({ error: 'Invalid path' });
    }

    const width = w !== undefined ? parseInt(w, 10) : undefined;
    const height = h !== undefined ? parseInt(h, 10) : undefined;
    const quality = q !== undefined ? parseInt(q, 10) : undefined;

    if (w !== undefined && (isNaN(width!) || width! <= 0)) {
      return res.status(400).send({ error: 'Invalid width parameter' });
    }
    if (h !== undefined && (isNaN(height!) || height! <= 0)) {
      return res.status(400).send({ error: 'Invalid height parameter' });
    }
    if (
      q !== undefined &&
      (isNaN(quality!) || quality! <= 0 || quality! > 100)
    ) {
      return res
        .status(400)
        .send({ error: 'Invalid quality parameter (must be 1-100)' });
    }

    const validFits = [
      'cover',
      'contain',
      'fill',
      'inside',
      'outside',
    ] as const;
    if (fit && !validFits.includes(fit as any)) {
      return res.status(400).send({ error: 'Invalid fit parameter' });
    }

    const key = this.cacheKey(path, w, h, q, fit);

    try {
      let promise = this.inflight.get(key);
      if (!promise) {
        promise = this.imagesService.resize({
          path,
          w: width,
          h: height,
          q: quality,
          fit: fit as any,
        });
        this.inflight.set(key, promise);
        // Clean up after resolve so next request goes through fresh
        promise.finally(() => this.inflight.delete(key));
      }

      const result = await promise;

      res.header('Content-Type', result.mime);
      res.header('Content-Length', String(result.buffer.length));
      res.header('Cache-Control', 'public, max-age=31536000, immutable');
      res.header('Vary', 'Accept-Encoding');
      res.status(200).send(result.buffer);
    } catch (err: any) {
      this.logger.error(`Image resize failed: ${path}`, err.message);
      if (err.message?.startsWith('Image not found')) {
        return res.status(404).send({ error: 'Image not found' });
      }
      return res.status(500).send({ error: 'Image processing failed' });
    }
  }
}
