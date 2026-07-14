import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
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

export interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

const CONFIG_KEYS = [
  'storage_provider',
  'storage_r2_endpoint',
  'storage_r2_access_key',
  'storage_r2_secret_key',
  'storage_r2_bucket',
  'storage_r2_public_url',
] as const;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private config: StorageConfig = { provider: 'local' };

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<StorageConfig> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...CONFIG_KEYS] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const cfg: StorageConfig = {
      provider: (map.get('storage_provider') as 'local' | 'r2') || 'local',
      r2Endpoint: map.get('storage_r2_endpoint'),
      r2AccessKey: map.get('storage_r2_access_key'),
      r2SecretKey: map.get('storage_r2_secret_key'),
      r2Bucket: map.get('storage_r2_bucket'),
      r2PublicUrl: map.get('storage_r2_public_url'),
    };

    if (
      cfg.provider === 'r2' &&
      (!cfg.r2Endpoint || !cfg.r2AccessKey || !cfg.r2SecretKey || !cfg.r2Bucket)
    ) {
      throw new InternalServerErrorException(
        'R2 storage provider selected but missing required configuration',
      );
    }

    return cfg;
  }

  private getS3Client(config: StorageConfig): S3Client {
    if (
      config.provider !== 'r2' ||
      !config.r2Endpoint ||
      !config.r2AccessKey ||
      !config.r2SecretKey
    ) {
      throw new InternalServerErrorException('R2 not configured');
    }

    const key = `${config.r2Endpoint}|${config.r2AccessKey}`;
    if (!this.s3Client) {
      this.s3Client = this.buildS3Client(config);
      (this.s3Client as any).__configKey = key;
    } else if ((this.s3Client as any).__configKey !== key) {
      this.s3Client = this.buildS3Client(config);
      (this.s3Client as any).__configKey = key;
    }
    return this.s3Client;
  }

  private buildS3Client(config: StorageConfig): S3Client {
    return new S3Client({
      region: 'auto',
      endpoint: config.r2Endpoint!,
      credentials: {
        accessKeyId: config.r2AccessKey!,
        secretAccessKey: config.r2SecretKey!,
      },
      forcePathStyle: true,
    });
  }

  async resolveFilename(desired: string): Promise<string> {
    const ext = extname(desired);
    let base = desired
      .replace(ext, '')
      .replace(/[^a-zA-Z0-9_. -]/g, '')
      .trim()
      .slice(0, 100)
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (!base) base = 'file';
    let candidate = base + ext;
    let counter = 1;
    while (
      await this.prisma.media.findFirst({ where: { filename: candidate } })
    ) {
      candidate = `${base}-${counter}${ext}`;
      counter++;
    }
    return candidate;
  }

  private async uploadToR2(
    name: string,
    body: Buffer,
    contentType: string,
    config: StorageConfig,
  ): Promise<string> {
    const client = this.getS3Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.r2Bucket!,
        Key: name,
        Body: body,
        ContentType: contentType,
      }),
    );
    const baseUrl = config.r2PublicUrl || config.r2Endpoint!;
    return `${baseUrl.replace(/\/$/, '')}/${name}`;
  }

  private async uploadToLocal(name: string, body: Buffer): Promise<string> {
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    const filepath = join(uploadDir, name);
    const parentDir = join(filepath, '..');
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
    try {
      await writeFile(filepath, body);
    } catch (err) {
      await unlink(filepath).catch(() => {});
      throw err;
    }
    return `/uploads/${name}`;
  }

  async read(key: string): Promise<Buffer> {
    const config = await this.getConfig();
    if (config.provider === 'r2') {
      const client = this.getS3Client(config);
      const resp = await client.send(
        new GetObjectCommand({ Bucket: config.r2Bucket!, Key: key }),
      );
      const body = await resp.Body?.transformToByteArray();
      return Buffer.from(body ?? new Uint8Array(0));
    }
    const filepath = join(process.cwd(), 'uploads', key);
    try {
      return await readFile(filepath);
    } catch (err) {
      this.logger.error(`Failed to read ${filepath}: ${(err as Error).message}`);
      throw err;
    }
  }

  async upload(
    file: UploadFile,
    filename?: string,
  ): Promise<{ url: string; filename: string; size: number }> {
    const config = await this.getConfig();
    let ext = extname(file.originalname).toLowerCase();
    if (!ext) ext = MIME_EXT_MAP[file.mimetype] || '';
    const name = filename
      ? await this.resolveFilename(filename + ext)
      : `${uuid()}${ext}`;

    const url =
      config.provider === 'r2'
        ? await this.uploadToR2(name, file.buffer, file.mimetype, config)
        : await this.uploadToLocal(name, file.buffer);

    return { url, filename: name, size: file.size };
  }

  async store(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const config = await this.getConfig();
    const url =
      config.provider === 'r2'
        ? await this.uploadToR2(key, buffer, mimeType, config)
        : await this.uploadToLocal(key, buffer);
    return url;
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

    const url =
      config.provider === 'r2'
        ? await this.uploadToR2(name, buffer, mimeType, config)
        : await this.uploadToLocal(name, buffer);

    return { url, filename: name, size: buffer.length };
  }

  async delete(filename: string): Promise<void> {
    const config = await this.getConfig();
    if (config.provider === 'r2') {
      const client = this.getS3Client(config);
      await client.send(
        new DeleteObjectCommand({ Bucket: config.r2Bucket!, Key: filename }),
      );
      return;
    }
    const filepath = join(process.cwd(), 'uploads', filename);
    try {
      await unlink(filepath);
    } catch (err) {
      this.logger.warn(
        `Failed to delete ${filepath}: ${(err as Error).message}`,
      );
    }
  }
}
