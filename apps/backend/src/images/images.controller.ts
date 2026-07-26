import {
  Controller,
  Get,
  Query,
  Res,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  BadGatewayException,
  Headers,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { ExternalImageFetchError, ImagesService } from './images.service';
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
    version?: string,
  ): string {
    return `${path}:${w || ''}:${h || ''}:${q || ''}:${fit || ''}:${version || ''}`;
  }

  private isNotModified(
    ifNoneMatch: string | string[] | undefined,
    etag: string,
  ): boolean {
    if (!ifNoneMatch) return false;
    const value = Array.isArray(ifNoneMatch)
      ? ifNoneMatch.join(',')
      : ifNoneMatch;
    return value
      .split(',')
      .map((candidate) => candidate.trim())
      .some(
        (candidate) =>
          candidate === '*' || candidate === etag || candidate === `W/${etag}`,
      );
  }

  @Get('resize')
  async resize(
    @Res({ passthrough: true }) res: FastifyReply,
    @Query('path') path: string,
    @Query('w') w?: string,
    @Query('h') h?: string,
    @Query('q') q?: string,
    @Query('fit') fit?: string,
    @Query('v') version?: string,
    @Headers('if-none-match') ifNoneMatch?: string | string[],
  ) {
    if (!path) {
      throw new BadRequestException('path parameter is required');
    }

    if (path.includes('..')) {
      throw new BadRequestException('Invalid path');
    }

    const width = w !== undefined ? parseInt(w, 10) : undefined;
    const height = h !== undefined ? parseInt(h, 10) : undefined;
    const quality = q !== undefined ? parseInt(q, 10) : undefined;

    if (w !== undefined && (isNaN(width!) || width! <= 0)) {
      throw new BadRequestException('Invalid width parameter');
    }
    if (h !== undefined && (isNaN(height!) || height! <= 0)) {
      throw new BadRequestException('Invalid height parameter');
    }
    if (
      q !== undefined &&
      (isNaN(quality!) || quality! <= 0 || quality! > 100)
    ) {
      throw new BadRequestException(
        'Invalid quality parameter (must be 1-100)',
      );
    }

    const validFits = [
      'cover',
      'contain',
      'fill',
      'inside',
      'outside',
    ] as const;
    if (fit && !validFits.includes(fit as any)) {
      throw new BadRequestException('Invalid fit parameter');
    }
    if (version && version.length > 200) {
      throw new BadRequestException('Invalid version parameter');
    }

    const key = this.cacheKey(path, w, h, q, fit, version);

    try {
      let promise = this.inflight.get(key);
      if (!promise) {
        promise = this.imagesService.resize({
          path,
          w: width,
          h: height,
          q: quality,
          fit: fit as any,
          version,
        });
        this.inflight.set(key, promise);
        // Avoid creating an unhandled rejecting promise while still cleaning
        // up both successful and failed in-flight requests.
        void promise.then(
          () => this.inflight.delete(key),
          () => this.inflight.delete(key),
        );
      }

      const result = await promise;
      const etag = `"${createHash('sha256')
        .update(result.buffer)
        .digest('base64url')}"`;

      res.header('Content-Type', result.mime);
      res.header('Cache-Control', 'public, max-age=3600, must-revalidate');
      res.header('ETag', etag);
      res.header('Vary', 'Accept-Encoding');
      if (this.isNotModified(ifNoneMatch, etag)) {
        res.status(304).send();
        return;
      }

      res.header('Content-Length', String(result.buffer.length));
      res.status(200).send(result.buffer);
    } catch (err: any) {
      res.header('Cache-Control', 'no-store');
      this.logger.error(`Image resize failed: ${path}`, err.message);
      if (err instanceof NotFoundException) {
        throw err;
      }
      if (err.message?.startsWith('Image not found')) {
        throw new NotFoundException('Image not found');
      }
      if (err instanceof ExternalImageFetchError) {
        throw new BadGatewayException('Image source could not be fetched');
      }
      throw new InternalServerErrorException('Image processing failed');
    }
  }
}
