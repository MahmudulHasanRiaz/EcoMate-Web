import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { v4 as uuid } from 'uuid';
import { existsSync } from 'fs';

const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
};

export interface StorageConfig {
  provider: 'local' | 'r2';
  r2Endpoint?: string;
  r2AccessKey?: string;
  r2SecretKey?: string;
  r2Bucket?: string;
  r2PublicUrl?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private config: StorageConfig = { provider: 'local' };

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<StorageConfig> {
    const provider = await this.prisma.systemSetting.findUnique({
      where: { key: 'storage_provider' },
    });
    const r2Endpoint = await this.prisma.systemSetting.findUnique({
      where: { key: 'storage_r2_endpoint' },
    });
    const r2AccessKey = await this.prisma.systemSetting.findUnique({
      where: { key: 'storage_r2_access_key' },
    });
    const r2SecretKey = await this.prisma.systemSetting.findUnique({
      where: { key: 'storage_r2_secret_key' },
    });
    const r2Bucket = await this.prisma.systemSetting.findUnique({
      where: { key: 'storage_r2_bucket' },
    });
    const r2PublicUrl = await this.prisma.systemSetting.findUnique({
      where: { key: 'storage_r2_public_url' },
    });

    return {
      provider: (provider?.value as 'local' | 'r2') || 'local',
      r2Endpoint: r2Endpoint?.value,
      r2AccessKey: r2AccessKey?.value,
      r2SecretKey: r2SecretKey?.value,
      r2Bucket: r2Bucket?.value,
      r2PublicUrl: r2PublicUrl?.value,
    };
  }

  private getS3Client(config: StorageConfig): S3Client {
    if (
      !this.s3Client &&
      config.provider === 'r2' &&
      config.r2Endpoint &&
      config.r2AccessKey &&
      config.r2SecretKey
    ) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: config.r2Endpoint,
        credentials: {
          accessKeyId: config.r2AccessKey,
          secretAccessKey: config.r2SecretKey,
        },
        forcePathStyle: true,
      });
    }
    return this.s3Client!;
  }

  async resolveFilename(desired: string): Promise<string> {
    const ext = extname(desired);
    let base = desired.replace(ext, '')
      .replace(/[^a-zA-Z0-9_. -]/g, '')
      .trim()
      .slice(0, 100)
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (!base) base = 'file';
    let candidate = base + ext;
    let counter = 1;
    while (await this.prisma.media.findFirst({ where: { filename: candidate } })) {
      candidate = `${base}-${counter}${ext}`;
      counter++;
    }
    return candidate;
  }

  async upload(
    file: Express.Multer.File,
    filename?: string,
  ): Promise<{ url: string; filename: string; size: number }> {
    const config = await this.getConfig();
    let ext = extname(file.originalname).toLowerCase();
    if (!ext) ext = MIME_EXT_MAP[file.mimetype] || '';
    const name = filename
      ? await this.resolveFilename(filename + ext)
      : `${uuid()}${ext}`;

    if (config.provider === 'r2' && config.r2Bucket) {
      const client = this.getS3Client(config);
      const cmd = new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: name,
        Body: file.buffer,
        ContentType: file.mimetype,
      });
      await client.send(cmd);
      const baseUrl = config.r2PublicUrl || config.r2Endpoint;
      const url = `${baseUrl?.replace(/\/$/, '')}/${name}`;
      return { url, filename: name, size: file.size };
    }

    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    const filepath = join(uploadDir, name);
    await writeFile(filepath, file.buffer);
    return { url: `/uploads/${name}`, filename: name, size: file.size };
  }

  async uploadFromBuffer(
    buffer: Buffer,
    originalname: string,
    mimeType: string,
    filename?: string,
  ): Promise<{ url: string; filename: string; size: number }> {
    const config = await this.getConfig();
    let ext = extname(originalname).toLowerCase();
    if (!ext) ext = MIME_EXT_MAP[mimeType] || '';
    const name = filename
      ? await this.resolveFilename(filename + ext)
      : `${uuid()}${ext}`;

    if (config.provider === 'r2' && config.r2Bucket) {
      const client = this.getS3Client(config);
      const cmd = new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: name,
        Body: buffer,
        ContentType: mimeType,
      });
      await client.send(cmd);
      const baseUrl = config.r2PublicUrl || config.r2Endpoint;
      const url = `${baseUrl?.replace(/\/$/, '')}/${name}`;
      return { url, filename: name, size: buffer.length };
    }

    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    const filepath = join(uploadDir, name);
    await writeFile(filepath, buffer);
    return { url: `/uploads/${name}`, filename: name, size: buffer.length };
  }

  async delete(filename: string): Promise<void> {
    const config = await this.getConfig();
    if (config.provider === 'r2' && config.r2Bucket) {
      const client = this.getS3Client(config);
      await client.send(
        new DeleteObjectCommand({ Bucket: config.r2Bucket, Key: filename }),
      );
      return;
    }
    const filepath = join(process.cwd(), 'uploads', filename);
    try {
      await unlink(filepath);
    } catch {
      /* ignore */
    }
  }
}
