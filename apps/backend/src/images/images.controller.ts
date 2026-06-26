import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ImagesService } from './images.service';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('images')
export class ImagesController {
  private readonly logger = new Logger(ImagesController.name);

  constructor(private readonly imagesService: ImagesService) {}

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

    try {
      const result = await this.imagesService.resize({
        path,
        w: w ? parseInt(w) : undefined,
        h: h ? parseInt(h) : undefined,
        q: q ? parseInt(q) : undefined,
        fit: fit as any,
      });

      res.header('Content-Type', result.mime);
      res.header('Content-Length', result.buffer.length);
      res.header('Cache-Control', 'public, max-age=31536000, immutable');
      res.header('Vary', 'Accept-Encoding');
      res.status(200).send(result.buffer);
    } catch (err: any) {
      this.logger.error(`Image resize failed: ${path}`, err.message);
      res.status(404).send({ error: 'Image not found' });
    }
  }
}
