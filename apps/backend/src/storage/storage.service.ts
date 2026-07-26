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
import { Upload } from '@aws-sdk/lib-storage';
import { readFile, writeFile, unlink, mkdir, rename } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import {
  join,
  extname,
  dirname,
  basename,
  resolve,
  relative,
  isAbsolute,
  sep,
} from 'path';
import { v4 as uuid } from 'uuid';
import { existsSync } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const R2_MULTIPART_PART_SIZE = 16 * 1024 * 1024;
const R2_MULTIPART_QUEUE_SIZE = 4;
const PRIVATE_LOCAL_BACKUP_PREFIX = 'private-local/';
const PRIVATE_R2_BACKUP_PREFIX = 'private-r2/';

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

interface PrivateBackupR2Config {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export interface StorageByteRange {
  start: number;
  end: number;
}

export type LegacyBackupProvider = 'local' | 'r2';

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
  private backupS3Client: S3Client | null = null;
  private backupS3ConfigKey = '';
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
      (!cfg.r2Endpoint ||
        !cfg.r2AccessKey ||
        !cfg.r2SecretKey ||
        !cfg.r2Bucket ||
        !cfg.r2PublicUrl)
    ) {
      throw new InternalServerErrorException(
        'R2 storage provider selected but endpoint, credentials, bucket, or public URL is missing',
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

    const key = `${config.r2Endpoint}|${config.r2AccessKey}|${config.r2SecretKey}`;
    if (!this.s3Client) {
      this.s3Client = this.buildS3Client(config);
      (this.s3Client as any).__configKey = key;
    } else if ((this.s3Client as any).__configKey !== key) {
      this.s3Client.destroy();
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

  private privateBackupR2Config(): PrivateBackupR2Config | null {
    const config = {
      endpoint: process.env.BACKUP_R2_ENDPOINT || '',
      accessKey: process.env.BACKUP_R2_ACCESS_KEY || '',
      secretKey: process.env.BACKUP_R2_SECRET_KEY || '',
      bucket: process.env.BACKUP_R2_BUCKET || '',
    };
    const configured = Object.values(config).some(Boolean);
    if (!configured) return null;
    if (Object.values(config).some((value) => !value)) {
      throw new InternalServerErrorException(
        'Dedicated backup R2 storage requires BACKUP_R2_ENDPOINT, BACKUP_R2_ACCESS_KEY, BACKUP_R2_SECRET_KEY, and BACKUP_R2_BUCKET',
      );
    }
    return config;
  }

  private getBackupS3Client(config: PrivateBackupR2Config): S3Client {
    const key = `${config.endpoint}|${config.accessKey}|${config.secretKey}`;
    if (!this.backupS3Client || this.backupS3ConfigKey !== key) {
      this.backupS3Client?.destroy();
      this.backupS3Client = new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
      });
      this.backupS3ConfigKey = key;
    }
    return this.backupS3Client;
  }

  private assertSafeStorageKey(key: string): void {
    if (
      !key ||
      key.includes('\0') ||
      key.includes('\\') ||
      isAbsolute(key) ||
      key.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new InternalServerErrorException('Unsafe storage key');
    }
  }

  private privateBackupPath(key: string): string {
    this.assertSafeStorageKey(key);
    const root = resolve(
      process.env.BACKUP_STORAGE_DIR || join(process.cwd(), 'backup-storage'),
    );
    const target = resolve(root, key);
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new InternalServerErrorException('Unsafe backup storage key');
    }
    return target;
  }

  private localMediaPath(key: string): string {
    this.assertSafeStorageKey(key);
    const root = resolve(process.cwd(), 'uploads');
    const target = resolve(root, key);
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new InternalServerErrorException('Unsafe media storage key');
    }
    return target;
  }

  private async legacyR2Config(): Promise<StorageConfig | null> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...CONFIG_KEYS] } },
    });
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const endpoint = map.get('storage_r2_endpoint');
    const accessKey = map.get('storage_r2_access_key');
    const secretKey = map.get('storage_r2_secret_key');
    const bucket = map.get('storage_r2_bucket');
    if (!endpoint || !accessKey || !secretKey || !bucket) return null;
    return {
      provider: 'r2',
      r2Endpoint: endpoint,
      r2AccessKey: accessKey,
      r2SecretKey: secretKey,
      r2Bucket: bucket,
      r2PublicUrl: map.get('storage_r2_public_url'),
    };
  }

  async legacyBackupProviders(): Promise<LegacyBackupProvider[]> {
    const currentProvider = (
      await this.prisma.systemSetting.findUnique({
        where: { key: 'storage_provider' },
        select: { value: true },
      })
    )?.value;
    const hasR2 = Boolean(await this.legacyR2Config());
    return currentProvider === 'r2' && hasR2
      ? ['r2', 'local']
      : hasR2
        ? ['local', 'r2']
        : ['local'];
  }

  async readLegacyBackupStream(
    key: string,
    provider: LegacyBackupProvider,
    range?: StorageByteRange,
  ): Promise<Readable> {
    this.assertSafeStorageKey(key);
    if (provider === 'local') {
      const filepath = this.localMediaPath(key);
      if (!existsSync(filepath)) {
        throw new InternalServerErrorException(
          `Legacy local backup not found: ${key}`,
        );
      }
      return createReadStream(filepath, range);
    }

    const config = await this.legacyR2Config();
    if (!config) {
      throw new InternalServerErrorException(
        'Legacy R2 credentials are unavailable',
      );
    }
    const response = await this.getS3Client(config).send(
      new GetObjectCommand({
        Bucket: config.r2Bucket!,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!response.Body) {
      throw new InternalServerErrorException('Empty legacy R2 backup object');
    }
    return response.Body as Readable;
  }

  async deleteLegacyBackup(
    key: string,
    provider: LegacyBackupProvider,
  ): Promise<void> {
    this.assertSafeStorageKey(key);
    if (provider === 'local') {
      try {
        await unlink(this.localMediaPath(key));
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return;
    }
    const config = await this.legacyR2Config();
    if (!config) {
      throw new InternalServerErrorException(
        'Legacy R2 credentials are unavailable',
      );
    }
    await this.getS3Client(config).send(
      new DeleteObjectCommand({ Bucket: config.r2Bucket!, Key: key }),
    );
  }

  createBackupKey(backupId: string, filename: string): string {
    this.assertSafeStorageKey(`${backupId}/${filename}`);
    const prefix = this.privateBackupR2Config()
      ? PRIVATE_R2_BACKUP_PREFIX
      : PRIVATE_LOCAL_BACKUP_PREFIX;
    return `${prefix}${backupId}/${filename}`;
  }

  private async multipartUpload(
    client: S3Client,
    bucket: string,
    key: string,
    stream: Readable,
    mimeType: string,
  ): Promise<void> {
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentType: mimeType,
      },
      partSize: R2_MULTIPART_PART_SIZE,
      queueSize: R2_MULTIPART_QUEUE_SIZE,
      leavePartsOnError: false,
    });
    try {
      await upload.done();
    } catch (err) {
      await upload.abort().catch(() => {});
      throw err;
    }
  }

  private async atomicLocalStream(
    filepath: string,
    stream: Readable,
  ): Promise<void> {
    const parentDir = dirname(filepath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
    const tmpPath = join(parentDir, `.${basename(filepath)}.${uuid()}.tmp`);
    try {
      const dest = createWriteStream(tmpPath, { flags: 'wx' });
      await pipeline(stream, dest);
      await rename(tmpPath, filepath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
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
    this.assertSafeStorageKey(name);
    const client = this.getS3Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.r2Bucket!,
        Key: name,
        Body: body,
        ContentType: contentType,
      }),
    );
    const baseUrl = config.r2PublicUrl!;
    return `${baseUrl.replace(/\/$/, '')}/${name}`;
  }

  private async uploadToLocal(name: string, body: Buffer): Promise<string> {
    this.assertSafeStorageKey(name);
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    const filepath = this.localMediaPath(name);
    const parentDir = dirname(filepath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
    const tmpPath = join(parentDir, `.${basename(filepath)}.${uuid()}.tmp`);
    try {
      await writeFile(tmpPath, body, { flag: 'wx' });
      await rename(tmpPath, filepath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
    return `/uploads/${name}`;
  }

  async read(key: string): Promise<Buffer> {
    this.assertSafeStorageKey(key);
    const config = await this.getConfig();
    if (config.provider === 'r2') {
      const client = this.getS3Client(config);
      const resp = await client.send(
        new GetObjectCommand({ Bucket: config.r2Bucket!, Key: key }),
      );
      const body = await resp.Body?.transformToByteArray();
      return Buffer.from(body ?? new Uint8Array(0));
    }
    const filepath = this.localMediaPath(key);
    try {
      return await readFile(filepath);
    } catch (err) {
      this.logger.error(
        `Failed to read ${filepath}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Read the authoritative media object using its persisted URL, rather than
   * assuming the currently selected provider. This keeps legacy local media
   * processable after switching to R2 (and retained R2 media processable after
   * switching back to local).
   */
  async readMediaOriginal(filename: string, url: string): Promise<Buffer> {
    const config = await this.getConfig();
    if (
      config.r2Endpoint &&
      config.r2AccessKey &&
      config.r2SecretKey &&
      config.r2Bucket &&
      config.r2PublicUrl
    ) {
      try {
        const mediaUrl = new URL(url);
        const publicBase = new URL(config.r2PublicUrl);
        const basePath = publicBase.pathname.replace(/\/+$/, '');
        if (
          mediaUrl.origin === publicBase.origin &&
          (mediaUrl.pathname === basePath ||
            mediaUrl.pathname.startsWith(`${basePath}/`))
        ) {
          const key = decodeURIComponent(
            mediaUrl.pathname.slice(basePath.length).replace(/^\/+/, ''),
          );
          this.assertSafeStorageKey(key);
          const response = await this.getS3Client({
            ...config,
            provider: 'r2',
          }).send(
            new GetObjectCommand({
              Bucket: config.r2Bucket,
              Key: key,
            }),
          );
          const body = await response.Body?.transformToByteArray();
          return Buffer.from(body ?? new Uint8Array(0));
        }
      } catch (error) {
        if (error instanceof InternalServerErrorException) throw error;
        // Not a URL under the retained R2 public base; try local/fallback.
      }
    }

    let localPath: string | null = null;
    if (url.startsWith('/uploads/')) {
      localPath = url.slice('/uploads/'.length);
    } else {
      try {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith('/uploads/')) {
          localPath = decodeURIComponent(
            parsed.pathname.slice('/uploads/'.length),
          );
        }
      } catch {}
    }
    if (localPath) {
      this.assertSafeStorageKey(localPath);
      return readFile(this.localMediaPath(localPath));
    }

    return this.read(filename);
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

  async store(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    this.assertSafeStorageKey(key);
    const config = await this.getConfig();
    const url =
      config.provider === 'r2'
        ? await this.uploadToR2(key, buffer, mimeType, config)
        : await this.uploadToLocal(key, buffer);
    return url;
  }

  /** Stream a file to storage without loading entire file into memory.
   *  For local: atomically publishes a streamed temp file.
   *  For R2: uses managed multipart upload for bounded memory and retries.
   *  Returns the public URL. */
  async storeStream(
    key: string,
    stream: Readable,
    mimeType: string,
  ): Promise<string> {
    this.assertSafeStorageKey(key);
    const config = await this.getConfig();
    if (config.provider === 'r2') {
      const client = this.getS3Client(config);
      await this.multipartUpload(
        client,
        config.r2Bucket!,
        key,
        stream,
        mimeType,
      );
      const baseUrl = config.r2PublicUrl!;
      return `${baseUrl.replace(/\/$/, '')}/${key}`;
    }
    // Local: write beside the destination, then atomically publish it.
    const filepath = this.localMediaPath(key);
    await this.atomicLocalStream(filepath, stream);
    return `/uploads/${key}`;
  }

  /**
   * Backup artifacts use a non-public namespace. By default they are written
   * outside `/uploads`; deployments may instead provide a dedicated private R2
   * bucket through BACKUP_R2_* environment variables.
   */
  async storeBackupStream(
    key: string,
    stream: Readable,
    mimeType: string,
  ): Promise<void> {
    this.assertSafeStorageKey(key);
    if (key.startsWith(PRIVATE_R2_BACKUP_PREFIX)) {
      const config = this.privateBackupR2Config();
      if (!config) {
        throw new InternalServerErrorException(
          'Private R2 backup storage is not configured',
        );
      }
      await this.multipartUpload(
        this.getBackupS3Client(config),
        config.bucket,
        key,
        stream,
        mimeType,
      );
      return;
    }
    if (!key.startsWith(PRIVATE_LOCAL_BACKUP_PREFIX)) {
      throw new InternalServerErrorException('Invalid private backup key');
    }
    await this.atomicLocalStream(this.privateBackupPath(key), stream);
  }

  async readBackupStream(
    key: string,
    range?: StorageByteRange,
  ): Promise<Readable> {
    this.assertSafeStorageKey(key);
    if (key.startsWith(PRIVATE_R2_BACKUP_PREFIX)) {
      const config = this.privateBackupR2Config();
      if (!config) {
        throw new InternalServerErrorException(
          'Private R2 backup storage is not configured',
        );
      }
      const response = await this.getBackupS3Client(config).send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      if (!response.Body) {
        throw new InternalServerErrorException('Empty private backup object');
      }
      return response.Body as Readable;
    }
    if (key.startsWith(PRIVATE_LOCAL_BACKUP_PREFIX)) {
      const filepath = this.privateBackupPath(key);
      if (!existsSync(filepath)) {
        throw new InternalServerErrorException(
          `Private backup not found: ${key}`,
        );
      }
      return createReadStream(filepath, range);
    }

    // Backward compatibility for artifacts created before private storage.
    // Try both retained local storage and retained R2 credentials so changing
    // the active media provider does not strand historical backups.
    let lastError: unknown;
    for (const provider of await this.legacyBackupProviders()) {
      try {
        return await this.readLegacyBackupStream(key, provider, range);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new InternalServerErrorException('Legacy backup not found');
  }

  async deleteBackup(key: string): Promise<void> {
    this.assertSafeStorageKey(key);
    if (key.startsWith(PRIVATE_R2_BACKUP_PREFIX)) {
      const config = this.privateBackupR2Config();
      if (!config) {
        throw new InternalServerErrorException(
          'Private R2 backup storage is not configured',
        );
      }
      await this.getBackupS3Client(config).send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      return;
    }
    if (key.startsWith(PRIVATE_LOCAL_BACKUP_PREFIX)) {
      try {
        await unlink(this.privateBackupPath(key));
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return;
    }
    const results = await Promise.allSettled(
      (await this.legacyBackupProviders()).map((provider) =>
        this.deleteLegacyBackup(key, provider),
      ),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }

  /** Stream file content from storage (no full Buffer load).
   *  For local: returns a ReadStream. For R2: returns the S3 response body stream. */
  async readStream(key: string, range?: StorageByteRange): Promise<Readable> {
    this.assertSafeStorageKey(key);
    const config = await this.getConfig();
    if (config.provider === 'r2') {
      const client = this.getS3Client(config);
      const resp = await client.send(
        new GetObjectCommand({
          Bucket: config.r2Bucket!,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      const body = resp.Body;
      if (!body)
        throw new InternalServerErrorException('Empty response from R2');
      // AWS S3 SDK returns a Readable for Node.js runtime
      return body as Readable;
    }
    const filepath = this.localMediaPath(key);
    if (!existsSync(filepath)) {
      throw new InternalServerErrorException(`File not found: ${key}`);
    }
    return createReadStream(filepath, range);
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
    this.assertSafeStorageKey(filename);
    const config = await this.getConfig();
    if (config.provider === 'r2') {
      const client = this.getS3Client(config);
      await client.send(
        new DeleteObjectCommand({ Bucket: config.r2Bucket!, Key: filename }),
      );
      return;
    }
    const filepath = this.localMediaPath(filename);
    try {
      await unlink(filepath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return;
      this.logger.warn(
        `Failed to delete ${filepath}: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
