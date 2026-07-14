import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaQueueService } from './media-queue.service';

const DERIVATIVE_SIZES = [
  { name: 'thumbnail', width: 150 },
  { name: 'small', width: 320 },
  { name: 'medium', width: 640 },
  { name: 'large', width: 1200 },
] as const;

const NON_NATIVE_FORMATS = new Set([
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/avif',
]);

@Processor('media')
export class MediaQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaQueue: MediaQueueService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'recover') {
      await this.mediaQueue.recoverStuck();
      return;
    }

    const { mediaId } = job.data as { mediaId: string };

    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      this.logger.warn(`Media ${mediaId} not found, skipping`);
      return;
    }

    if (!media.mimeType.startsWith('image/')) {
      await this.prisma.media.update({
        where: { id: mediaId },
        data: { processingStatus: 'READY' },
      });
      return;
    }

    await this.prisma.media.update({
      where: { id: mediaId },
      data: { processingStatus: 'PROCESSING' },
    });

    try {
      const sharp = (await import('sharp')).default;
      const original = await this.storage.read(media.filename);
      const metadata = await sharp(original).metadata();
      const needsJpegFallback = NON_NATIVE_FORMATS.has(media.mimeType);

      const manifest: Record<string, string> = {};
      let blurUrl: string | null = null;

      for (const size of DERIVATIVE_SIZES) {
        const webpBuf = await sharp(original)
          .resize({ width: size.width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        const key = `derivatives/${mediaId}/${size.name}.webp`;
        const url = await this.storage.store(key, webpBuf, 'image/webp');
        manifest[size.name] = url;

        if (needsJpegFallback) {
          const jpegBuf = await sharp(original)
            .resize({ width: size.width, withoutEnlargement: true })
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer();
          const jpegKey = `derivatives/${mediaId}/${size.name}.jpg`;
          const jpegUrl = await this.storage.store(jpegKey, jpegBuf, 'image/jpeg');
          manifest[`${size.name}_jpg`] = jpegUrl;
        }
      }

      const blurWebp = await sharp(original)
        .resize(16, 16, { fit: 'cover' })
        .webp({ quality: 20 })
        .toBuffer();
      blurUrl = `data:image/webp;base64,${blurWebp.toString('base64')}`;

      await this.prisma.media.update({
        where: { id: mediaId },
        data: {
          processingStatus: 'READY',
          derivativeManifest: manifest,
          blurUrl,
          updatedAt: new Date(),
        },
      });

    } catch (err) {
      this.logger.error(
        `Failed to process media ${mediaId}: ${(err as Error).message}`,
      );
      await this.prisma.media.update({
        where: { id: mediaId },
        data: {
          processingStatus: 'FAILED',
          processingError: (err as Error).message,
          updatedAt: new Date(),
        },
      });
    }
  }
}
