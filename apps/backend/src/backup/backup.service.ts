import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, unlink, rm, stat, writeFile, readFile, copyFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Transform, Readable } from 'stream';
import { tmpdir } from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const execFileAsync = promisify(execFile);

export interface CreateBackupDto {
  scope: 'db_only' | 'db_files';
  type?: 'manual' | 'scheduled';
}

export interface BackupListQuery {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  scope?: string;
  status?: string;
}

function getPgDumpArgs(): string[] {
  const args: string[] = [];
  if (process.env.DATABASE_URL) {
    // DATABASE_URL contains everything; use it directly
    return [];
  }
  if (process.env.PGDATABASE) args.push('-d', process.env.PGDATABASE);
  if (process.env.PGHOST) args.push('-h', process.env.PGHOST);
  if (process.env.PGPORT) args.push('-p', process.env.PGPORT);
  if (process.env.PGUSER) args.push('-U', process.env.PGUSER);
  return args;
}

function parseDbUrl(url: string): { database: string; host: string; port: string; user: string; password: string } {
  const u = new URL(url);
  return {
    database: u.pathname.replace(/^\//, ''),
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly DB_DUMP_TIMEOUT = parseInt(process.env.BACKUP_DUMP_TIMEOUT || '1800000', 10); // 30min

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue('backup') private backupQueue: Queue,
  ) {}

  async triggerManual(scope: 'db_only' | 'db_files'): Promise<{ id: string }> {
    const job = await this.prisma.backupJob.create({
      data: { type: 'manual', scope, status: 'pending' },
    });
    await this.backupQueue.add('backup', { backupId: job.id }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    return { id: job.id };
  }

  async runBackupPipeline(backupId: string): Promise<void> {
    const record = await this.prisma.backupJob.findUnique({ where: { id: backupId } });
    if (!record) throw new Error(`BackupJob ${backupId} not found`);

    // Prevent concurrent backups — if another is already running, abort
    const running = await this.prisma.backupJob.findFirst({
      where: { status: 'running', id: { not: backupId } },
    });
    if (running) {
      await this.prisma.backupJob.update({
        where: { id: backupId },
        data: { status: 'failed', errorMessage: 'Another backup is already running' },
      });
      return;
    }

    await this.prisma.backupJob.update({
      where: { id: backupId },
      data: { status: 'running', startedAt: new Date() },
    });

    const tmpDir = join(tmpdir(), `backup-${backupId}`);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

    try {
      const { dumpPath, dumpSize } = await this.createDbDump(tmpDir);
      const checksum = createHash('sha256');
      let totalSize = dumpSize;
      let filesSize: bigint | null = null;

      // Build final archive
      let finalPath: string;
      let finalName: string;

      if (record.scope === 'db_files') {
        finalName = `backup-${backupId}.tar.gz`;
        finalPath = join(tmpDir, finalName);
        // Package dump + include_paths into tar.gz
        const includePaths = await this.getSettingJSON('backup_include_paths', ['uploads']);
        await this.createTarArchive(tmpDir, dumpPath, includePaths, finalPath, checksum);
        const fStat = await stat(finalPath);
        totalSize = BigInt(fStat.size);
        // Compute content files size by summing include paths
        const uploadsDir = join(process.cwd(), 'uploads');
        let contentSize = BigInt(0);
        for (const relPath of includePaths) {
          const absPath = join(uploadsDir, relPath);
          if (existsSync(absPath)) {
            try {
              const { stdout } = await execFileAsync('du', ['-sb', absPath]);
              const size = stdout.split('\t')[0];
              contentSize += BigInt(size);
            } catch {}
          }
        }
        filesSize = contentSize > BigInt(0) ? contentSize : null;
      } else {
        // Compress dump with gzip, compute checksum while streaming
        finalName = `backup-${backupId}.sql.gz`;
        finalPath = join(tmpDir, finalName);
        const gzip = createGzip();
        const source = createReadStream(dumpPath);
        const hashTransform = new Transform({
          transform(chunk, _encoding, callback) {
            checksum.update(chunk);
            callback(null, chunk);
          },
        });
        const dest = createWriteStream(finalPath);
        await pipeline(source, gzip, hashTransform, dest);
      }

      const finalChecksum = checksum.digest('hex');
      const fStat = await stat(finalPath);
      const finalSize = fStat.size;

      // Upload to storage via streaming (no full file load into memory)
      const storageKey = `backups/${backupId}/${finalName}`;
      const fileStream = createReadStream(finalPath);
      await this.storage.storeStream(storageKey, fileStream, 'application/gzip');

      // Update record
      await this.prisma.backupJob.update({
        where: { id: backupId },
        data: {
          status: 'completed',
          fileKey: storageKey,
          fileSize: BigInt(finalSize),
          checksum: finalChecksum,
          dbDumpSize: BigInt(dumpSize),
          filesSize,
          completedAt: new Date(),
        },
      });

      // If scheduled, run cleanup
      if (record.type === 'scheduled') {
        await this.performCleanup();
      }
    } catch (err) {
      this.logger.error(`Backup ${backupId} failed: ${(err as Error).message}`);
      await this.prisma.backupJob.update({
        where: { id: backupId },
        data: { status: 'failed', errorMessage: (err as Error).message },
      });
    } finally {
      // Cleanup tmp dir
      unlink(join(tmpDir, 'dump.sql')).catch(() => {});
      unlink(join(tmpDir, 'backup.tar.gz')).catch(() => {});
      unlink(join(tmpDir, 'backup.sql.gz')).catch(() => {});
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async createDbDump(tmpDir: string): Promise<{ dumpPath: string; dumpSize: bigint }> {
    const dumpPath = join(tmpDir, 'dump.sql');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new InternalServerErrorException('DATABASE_URL not configured');

    const parsed = parseDbUrl(dbUrl);
    const env = {
      ...process.env,
      PGPASSWORD: parsed.password,
    };

    const args = [
      '--no-owner', '--no-acl', '--clean', '--if-exists',
      '-h', parsed.host,
      '-p', parsed.port,
      '-U', parsed.user,
      '-d', parsed.database,
      '-f', dumpPath,
    ];

    const { stderr } = await execFileAsync('pg_dump', args, {
      env,
      timeout: this.DB_DUMP_TIMEOUT,
    });

    if (stderr && !stderr.includes('deprecated')) {
      this.logger.warn(`pg_dump stderr: ${stderr}`);
    }

    const dumpStat = await stat(dumpPath);
    return { dumpPath, dumpSize: BigInt(dumpStat.size) };
  }

  private async createTarArchive(
    tmpDir: string,
    dumpPath: string,
    includePaths: string[],
    outputPath: string,
    checksum: ReturnType<typeof createHash>,
  ): Promise<void> {
    // Collect files from includePaths
    const filesToAdd = ['dump.sql'];
    const uploadsDir = join(process.cwd(), 'uploads');
    for (const relPath of includePaths) {
      const absPath = join(uploadsDir, relPath);
      if (existsSync(absPath)) {
        filesToAdd.push(relPath);
      }
    }

    // Build tar.gz args
    const args = ['-czf', outputPath, '-C', tmpDir, 'dump.sql'];
    if (filesToAdd.length > 1) {
      args.push('-C', uploadsDir, ...filesToAdd.slice(1));
    }

    await execFileAsync('tar', args, { timeout: 300000 });

    // Update checksum via streaming (no full file load into memory)
    const hashStream = createReadStream(outputPath);
    for await (const chunk of hashStream) {
      checksum.update(chunk as Buffer);
    }
  }

  async performCleanup(): Promise<number> {
    const [daily, weekly, monthly, yearly, maxTotal] = await Promise.all([
      this.getSetting('backup_retention_daily', '7').then(Number),
      this.getSetting('backup_retention_weekly', '4').then(Number),
      this.getSetting('backup_retention_monthly', '3').then(Number),
      this.getSetting('backup_retention_yearly', '1').then(Number),
      this.getSetting('backup_max_total', '30').then(Number),
    ]);

    let deleted = 0;
    const all = await this.prisma.backupJob.findMany({
      where: { status: 'completed', locked: false, type: 'scheduled' },
      orderBy: { completedAt: 'desc' },
    });

    // Group by age bucket
    const now = Date.now();
    const dayMs = 86400000;
    const buckets = { daily: [] as typeof all, weekly: [] as typeof all, monthly: [] as typeof all, yearly: [] as typeof all };

    for (const b of all) {
      if (!b.completedAt) continue;
      const age = now - b.completedAt.getTime();
      if (age < 7 * dayMs) buckets.daily.push(b);
      else if (age < 31 * dayMs) buckets.weekly.push(b);
      else if (age < 365 * dayMs) buckets.monthly.push(b);
      else buckets.yearly.push(b);
    }

    const limits: Record<string, number> = {
      daily: Math.max(daily, 0),
      weekly: Math.max(weekly, 0),
      monthly: Math.max(monthly, 0),
      yearly: Math.max(yearly, 0),
    };

    for (const [bucket, items] of Object.entries(buckets)) {
      const limit = limits[bucket];
      if (limit >= 0 && items.length > limit) {
        const toDelete = items.slice(limit);
        for (const item of toDelete) {
          await this.deleteBackupRecord(item.id);
          deleted++;
        }
      }
    }

    // Enforce max total
    const remaining = await this.prisma.backupJob.count({
      where: { status: 'completed', locked: false, type: 'scheduled' },
    });
    if (remaining > maxTotal) {
      const excess = await this.prisma.backupJob.findMany({
        where: { status: 'completed', locked: false, type: 'scheduled' },
        orderBy: { completedAt: 'asc' },
        take: remaining - maxTotal,
      });
      for (const item of excess) {
        await this.deleteBackupRecord(item.id);
        deleted++;
      }
    }

    return deleted;
  }

  private async deleteBackupRecord(id: string): Promise<void> {
    const job = await this.prisma.backupJob.findUnique({ where: { id } });
    if (job?.fileKey) {
      try { await this.storage.delete(job.fileKey); } catch {}
    }
    await this.prisma.backupJob.delete({ where: { id } });
  }

  async listBackups(query: BackupListQuery) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.scope) where.scope = query.scope;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.prisma.backupJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.backupJob.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBackup(id: string) {
    const job = await this.prisma.backupJob.findUnique({ where: { id } });
    if (!job) throw new BadRequestException('Backup not found');
    return job;
  }

  async downloadBackup(id: string): Promise<{ stream: NodeJS.ReadableStream; filename: string; mimeType: string }> {
    const job = await this.getBackup(id);
    if (!job.fileKey) throw new BadRequestException('Backup file not available');
    if (job.status !== 'completed') throw new BadRequestException('Backup not completed');

    const filename = job.fileKey.split('/').pop() || `backup-${id}.sql.gz`;
    return { stream: await this.storage.readStream(job.fileKey), filename, mimeType: 'application/gzip' };
  }

  async restoreFromBackup(id: string): Promise<{ id: string }> {
    const job = await this.getBackup(id);
    if (job.status !== 'completed') throw new BadRequestException('Backup not completed');

    // Check no other restore in progress
    const activeRestore = await this.prisma.backupJob.findFirst({
      where: { status: 'restoring' },
    });
    if (activeRestore) throw new ConflictException('Another restore is in progress');

    // Auto-backup before restore
    const autoBackup = await this.getSetting('backup_restore_auto_backup', 'true');
    if (autoBackup === 'true') {
      await this.triggerManual('db_files');
    }

    await this.prisma.backupJob.update({
      where: { id },
      data: { status: 'restoring' },
    });

    // Run restore async via direct call (not queue — need sequential)
    this.runRestorePipeline(id).catch((err) => {
      this.logger.error(`Restore ${id} failed: ${err.message}`);
      this.prisma.backupJob.update({
        where: { id },
        data: { status: 'failed', errorMessage: err.message },
      }).catch(() => {});
    });

    return { id };
  }

  async restoreFromUpload(fileBuffer: Buffer, filename: string): Promise<{ id: string }> {
    // Create a backup record in restoring status
    const job = await this.prisma.backupJob.create({
      data: {
        type: 'manual',
        scope: filename.endsWith('.tar.gz') ? 'db_files' : 'db_only',
        status: 'restoring',
        fileSize: BigInt(fileBuffer.length),
      },
    });

    // Save to temp and restore
    const tmpDir = join(tmpdir(), `restore-upload-${job.id}`);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, filename);
    await writeFile(tmpPath, fileBuffer);

    this.runRestorePipeline(job.id, { tmpPath, isUpload: true }).catch((err) => {
      this.logger.error(`Upload restore ${job.id} failed: ${err.message}`);
      this.prisma.backupJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMessage: err.message },
      }).catch(() => {});
    });

    return { id: job.id };
  }

  async uploadOnly(fileBuffer: Buffer, filename: string): Promise<{ id: string }> {
    const tmpDir = join(tmpdir(), `backup-upload-only-${randomUUID()}`);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

    // Store file to temp
    const tmpPath = join(tmpDir, filename);
    await writeFile(tmpPath, fileBuffer);

    // Compute checksum
    const checksum = createHash('sha256');
    checksum.update(fileBuffer);
    const checksumHex = checksum.digest('hex');

    const job = await this.prisma.backupJob.create({
      data: {
        type: 'manual',
        scope: filename.endsWith('.tar.gz') ? 'db_files' : 'db_only',
        status: 'pending',
        fileSize: BigInt(fileBuffer.length),
        checksum: checksumHex,
      },
    });

    // Upload to storage
    const storageKey = `backups/${job.id}/${filename}`;
    await this.storage.store(storageKey, fileBuffer, filename.endsWith('.tar.gz') ? 'application/gzip' : 'application/gzip');

    // Mark completed
    await this.prisma.backupJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        fileKey: storageKey,
        completedAt: new Date(),
      },
    });

    // Cleanup
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return { id: job.id };
  }

  private async runRestorePipeline(
    backupId: string,
    opts?: { tmpPath?: string; isUpload?: boolean },
  ): Promise<void> {
    const tmpDir = join(tmpdir(), `restore-${backupId}`);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

    try {
      let sqlDumpPath: string;
      let tmpPath = opts?.tmpPath;

      if (!tmpPath) {
        // Download from storage via streaming (no full file load)
        const job = await this.prisma.backupJob.findUnique({ where: { id: backupId } });
        if (!job?.fileKey) throw new Error('No backup file');
        tmpPath = join(tmpDir, job.fileKey.split('/').pop()!);
        const readStream = await this.storage.readStream(job.fileKey);
        const { createWriteStream } = await import('fs');
        const dest = createWriteStream(tmpPath);
        const { pipeline } = await import('stream/promises');
        await pipeline(readStream, dest);
      }

      // Decompress
      if (tmpPath.endsWith('.tar.gz')) {
        // Extract tar.gz
        await execFileAsync('tar', ['-xzf', tmpPath, '-C', tmpDir], { timeout: 300000 });
        sqlDumpPath = join(tmpDir, 'dump.sql');
      } else {
        // Gunzip
        const gunzip = createGunzip();
        const source = createReadStream(tmpPath);
        sqlDumpPath = join(tmpDir, 'restore.sql');
        const dest = createWriteStream(sqlDumpPath);
        await pipeline(source, gunzip, dest);
      }

      // Run psql restore
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new Error('DATABASE_URL not configured');
      const parsed = parseDbUrl(dbUrl);

      // Terminate connections
      try {
        await execFileAsync('psql', [
          '-h', parsed.host, '-p', parsed.port, '-U', parsed.user,
          '-d', parsed.database,
          '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${parsed.database}' AND pid <> pg_backend_pid()`,
        ], { env: { ...process.env, PGPASSWORD: parsed.password }, timeout: 30000 });
      } catch {}

      // Restore
      const { stderr } = await execFileAsync('psql', [
        '-h', parsed.host, '-p', parsed.port, '-U', parsed.user,
        '-d', parsed.database,
        '-f', sqlDumpPath,
      ], { env: { ...process.env, PGPASSWORD: parsed.password }, timeout: this.DB_DUMP_TIMEOUT });

      if (stderr && !stderr.includes('deprecated')) {
        this.logger.warn(`psql stderr: ${stderr}`);
      }

      await this.prisma.backupJob.update({
        where: { id: backupId },
        data: { status: 'completed', completedAt: new Date() },
      });
    } finally {
      // Cleanup
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (opts?.isUpload && opts?.tmpPath) {
        unlink(opts.tmpPath).catch(() => {});
      }
    }
  }

  async toggleLock(id: string, locked: boolean): Promise<void> {
    const job = await this.getBackup(id);
    await this.prisma.backupJob.update({
      where: { id },
      data: { locked },
    });
  }

  async deleteBackup(id: string): Promise<void> {
    await this.deleteBackupRecord(id);
  }

  // Settings helpers
  async getSetting(key: string, defaultValue?: string): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value ?? defaultValue ?? null;
  }

  async getSettingJSON<T>(key: string, defaultValue: T): Promise<T> {
    const val = await this.getSetting(key);
    if (!val) return defaultValue;
    try { return JSON.parse(val); } catch { return defaultValue; }
  }

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'backup_' } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  async updateSettings(body: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(body)) {
      if (!key.startsWith('backup_')) continue;
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      });
    }
    // Re-register repeatable job if schedule changed
    if (body['backup_schedule_enabled'] !== undefined || body['backup_schedule_cron'] !== undefined) {
      await this.reregisterRepeatableJob();
    }
  }

  private async reregisterRepeatableJob(): Promise<void> {
    const enabled = await this.getSetting('backup_schedule_enabled', 'false');
    const cron = (await this.getSetting('backup_schedule_cron', '0 2 * * *')) ?? undefined;

    // Remove existing repeatable job
    try {
      await this.backupQueue.removeRepeatable('scheduled-backup', { pattern: cron });
    } catch {}

    if (enabled !== 'true') return;

    const scope = await this.getSetting('backup_default_scope', 'db_only');

    await this.backupQueue.add('scheduled-backup', { scope, type: 'scheduled' }, {
      repeat: { pattern: cron },
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.reregisterRepeatableJob();
  }
}