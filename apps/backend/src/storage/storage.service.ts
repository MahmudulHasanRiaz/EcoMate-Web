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

  async upload(
    file: Express.Multer.File,
  ): Promise<{ url: string; filename: string; size: number }> {
    const config = await this.getConfig();
    const ext = extname(file.originalname).toLowerCase();
    const filename = `${uuid()}${ext}`;

    if (config.provider === 'r2' && config.r2Bucket) {
      const client = this.getS3Client(config);
      const cmd = new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype,
      });
      await client.send(cmd);
      const baseUrl = config.r2PublicUrl || config.r2Endpoint;
      const url = `${baseUrl?.replace(/\/$/, '')}/${filename}`;
      return { url, filename, size: file.size };
    }

    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    const filepath = join(uploadDir, filename);
    await writeFile(filepath, file.buffer);
    return { url: `/uploads/${filename}`, filename, size: file.size };
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
