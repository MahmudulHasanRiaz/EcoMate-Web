import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { MediaService } from '../media/media.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

const MAX_BYTES = 15 * 1024 * 1024; // 15MB per file
const MAX_BULK = 20;

const UPLOADS_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorageConfig = diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + extname(file.originalname));
  },
});

const fileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  cb: (err: Error | null, accept: boolean) => void,
) => {
  if (
    !file.mimetype.startsWith('image/') &&
    !file.mimetype.startsWith('video/')
  ) {
    return cb(new BadRequestException('Only images & videos allowed'), false);
  }
  cb(null, true);
};

@Controller('upload')
@RequiresFeature('admin_media')
export class UploadController {
  constructor(private readonly media: MediaService) {}

  @Post('image')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('superadmin', 'admin', 'manager', 'cashier')
  @UseInterceptors(
    FileInterceptor('file', { storage: diskStorageConfig, limits: { fileSize: MAX_BYTES }, fileFilter }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('filename') filename: string | undefined,
    @Body('alt') alt: string | undefined,
    @CurrentUser() user: { id: string } | null,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.media.ingestFromMulter(file, {
      filename,
      alt,
      uploadedBy: user?.id,
    });
  }

  @Post('images')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('superadmin', 'admin', 'manager', 'cashier')
  @UseInterceptors(
    FilesInterceptor('files', MAX_BULK, {
      storage: diskStorageConfig,
      limits: { fileSize: MAX_BYTES },
      fileFilter,
    }),
  )
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: { id: string } | null,
  ) {
    if (!files?.length) throw new BadRequestException('No files uploaded');
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
    for (const file of files) {
      try {
        const out = await this.media.ingestFromMulter(file, {
          uploadedBy: user?.id,
        });
        results.push({ ok: true, originalname: file.originalname, ...out });
      } catch (err) {
        results.push({
          ok: false,
          originalname: file.originalname,
          error: (err as Error).message,
        });
      }
    }
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
