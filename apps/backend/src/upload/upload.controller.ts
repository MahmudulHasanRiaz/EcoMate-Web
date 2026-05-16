import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/', 'video/'];
        if (!allowed.some((t) => file.mimetype.startsWith(t)))
          return cb(
            new BadRequestException('Only images & videos allowed'),
            false,
          );
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const result = await this.storage.upload(file);
    await this.prisma.media.create({
      data: {
        filename: result.filename,
        url: result.url,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
    return result;
  }
}
