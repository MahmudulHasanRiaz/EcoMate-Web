import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ImagesService } from './images.service';

@Controller('images')
export class ImagesController {
  private readonly logger = new Logger(ImagesController.name);

  constructor(private readonly imagesService: ImagesService) {}

  @Get('resize')
  async resize(
    @Res() res: Response,
    @Query('path') path: string,
    @Query('w') w?: string,
    @Query('h') h?: string,
    @Query('q') q?: string,
    @Query('fit') fit?: string,
  ) {
    if (!path) {
      return res.status(400).json({ error: 'path parameter is required' });
    }

    if (path.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    try {
      const result = await this.imagesService.resize({
        path,
        w: w ? parseInt(w) : undefined,
        h: h ? parseInt(h) : undefined,
        q: q ? parseInt(q) : undefined,
        fit: fit as any,
      });

      res.setHeader('Content-Type', result.mime);
      res.setHeader('Content-Length', result.buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Vary', 'Accept-Encoding');
      res.status(200).end(result.buffer);
    } catch (err: any) {
      this.logger.error(`Image resize failed: ${path}`, err.message);
      res.status(404).json({ error: 'Image not found' });
    }
  }
}
