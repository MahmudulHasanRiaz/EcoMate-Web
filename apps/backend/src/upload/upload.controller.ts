import {
  Controller,
  Post,
  BadRequestException,
  Body,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as fastify from 'fastify';
import { MediaService } from '../media/media.service';
import type { UploadFile } from '../storage/storage.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

const MAX_BYTES = 15 * 1024 * 1024; // 15MB per file
const MAX_BULK = 20;

@Controller('upload')
@RequiresFeature('admin_media')
export class UploadController {
  constructor(private readonly media: MediaService) {}

  @Post('image')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('superadmin', 'admin', 'manager', 'cashier')
  async uploadImage(
    @Req() req: fastify.FastifyRequest,
    @CurrentUser() user: { id: string } | null,
  ) {
    const file = await req.file();
    if (!file) throw new BadRequestException('No file uploaded');

    const filename = file.fields.filename ? (file.fields.filename as any).value : undefined;
    const alt = file.fields.alt ? (file.fields.alt as any).value : undefined;

    if (
      !file.mimetype?.startsWith('image/') &&
      !file.mimetype?.startsWith('video/')
    ) {
      throw new BadRequestException('Only images & videos allowed');
    }

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException('File too large');
    }

    const uploadFile: UploadFile = {
      buffer,
      mimetype: file.mimetype,
      size: buffer.length,
      originalname: file.filename,
    };

    return this.media.ingestFromMulter(uploadFile, {
      filename,
      alt,
      uploadedBy: user?.id,
    });
  }

  @Post('images')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('superadmin', 'admin', 'manager', 'cashier')
  async uploadImages(
    @Req() req: fastify.FastifyRequest,
    @CurrentUser() user: { id: string } | null,
  ) {
    const parts = req.files();
    const results: Array<{
      ok: boolean;
      id?: string;
      url?: string;
      filename?: string;
      size?: number;
      mimeType?: string;
      error?: string;
      originalname: string;
    }> = [];

    let count = 0;
    for await (const part of parts) {
      if (part.file) {
        count++;
        if (count > MAX_BULK) {
          results.push({
            ok: false,
            originalname: part.filename,
            error: 'Too many files uploaded',
          });
          continue;
        }

        try {
          if (
            !part.mimetype?.startsWith('image/') &&
            !part.mimetype?.startsWith('video/')
          ) {
            throw new BadRequestException('Only images & videos allowed');
          }

          const buffer = await part.toBuffer();
          if (buffer.length > MAX_BYTES) {
            throw new BadRequestException('File too large');
          }

          const uploadFile: UploadFile = {
            buffer,
            mimetype: part.mimetype,
            size: buffer.length,
            originalname: part.filename,
          };

          const out = await this.media.ingestFromMulter(uploadFile, {
            uploadedBy: user?.id,
          });
          results.push({ ok: true, originalname: part.filename, ...out });
        } catch (err) {
          results.push({
            ok: false,
            originalname: part.filename,
            error: (err as Error).message,
          });
        }
      }
    }

    if (!count) throw new BadRequestException('No files uploaded');
    return { data: results };
  }

  @Post('from-url')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('superadmin', 'admin', 'manager', 'cashier')
  async uploadFromUrl(
    @Body('url') url: string,
    @Body('filename') filename: string | undefined,
    @Body('alt') alt: string | undefined,
    @CurrentUser() user: { id: string } | null,
  ) {
    if (!url) throw new BadRequestException('url is required');
    return this.media.ingestFromUrl(url, {
      filename,
      alt,
      uploadedBy: user?.id,
    });
  }
}
