# Backup System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full backup/restore system for EcoMate admin at `/mon/backup/` — manual + scheduled backups, DB-only or DB+files, R2/local storage, restore from existing or uploaded files, retention-based cleanup.

**Architecture:** Monolithic NestJS module using BullMQ queue for async backup jobs. Reuses existing `StorageService` (S3/local), `SystemSetting` table for config, and `PrismaService` for DB. `pg_dump`/`psql` via `child_process.execFile`. Frontend with React 19, TanStack Router + Query.

**Tech Stack:** NestJS 11 + Fastify, Prisma 7, PostgreSQL, Redis/BullMQ. React 19 + Vite + TanStack Router/Query, shadcn/ui components.

## Global Constraints

- Prisma schema changes -> migrate dev -> generate -> commit (never separate)
- DTOs with `class-validator`
- Controllers thin; business logic in services
- All backup endpoints need admin auth, restore requires extra safeguards
- `execFile` (not `exec`) for shell commands (no injection)
- Frontend: `apiClient` for HTTP, TanStack Query for server state
- Build check: `npm run build --workspace=backend` + `npm run build --workspace=admin`
- No `prisma db push` in production — use `migrate dev` for dev

---

### Task 1: Add BackupJob Prisma Model + Migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (add model after `MobileBuild`)
- Create: `apps/backend/prisma/migrations/...` (via `migrate dev`)

- [ ] **Add BackupJob model to schema.prisma**

Append after `MobileBuild` model:

```prisma
model BackupJob {
  id            String    @id @default(cuid())
  type          String    // manual | scheduled
  scope         String    // db_only | db_files
  status        String    @default("pending") // pending | running | completed | failed | restoring
  fileKey       String?   // storage path: backups/{id}/{filename}
  fileSize      BigInt?   // total backup file size (bytes)
  checksum      String?   // SHA-256 hex
  dbDumpSize    BigInt?   // raw SQL dump size (bytes)
  filesSize     BigInt?   // content archive size (bytes, null if db_only)
  locked        Boolean   @default(false)
  errorMessage  String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status])
  @@index([createdAt])
  @@index([type])
}
```

- [ ] **Run migration**

```bash
cd apps/backend && npx prisma migrate dev --name add_backup_job
```

- [ ] **Verify migration and generate client**

```bash
cd apps/backend && npx prisma generate
```

- [ ] **Commit schema + migration**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat: add BackupJob model for backup system"
```

---

### Task 2: Backup Module — Core BackupService

**Files:**
- Create: `apps/backend/src/backup/backup.module.ts`
- Create: `apps/backend/src/backup/backup.service.ts`

- [ ] **Create `backup.module.ts`**

```ts
import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'backup' }),
  ],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
```

- [ ] **Create `backup.service.ts` — full service**

```ts
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
import { createReadStream, createWriteStream, unlink, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
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
        totalSize = fStat.size;
        // Calculate files size separately
        const rawDumpStat = await stat(dumpPath);
        filesSize = BigInt(totalSize - rawDumpStat.size);
      } else {
        // Compress dump with gzip
        finalName = `backup-${backupId}.sql.gz`;
        finalPath = join(tmpDir, finalName);
        const gzip = createGzip();
        const source = createReadStream(dumpPath);
        const dest = createWriteStream(finalPath);
        await pipeline(source, gzip, dest);
        // Update checksum with compressed
        const finalData = await import('fs/promises').then(fs => fs.readFile(finalPath));
        checksum.update(finalData);
      }

      const finalChecksum = checksum.digest('hex');
      const fStat = await stat(finalPath);
      const finalSize = fStat.size;

      // Upload to storage
      const storageKey = `backups/${backupId}/${finalName}`;
      const buffer = await import('fs/promises').then(fs => fs.readFile(finalPath));
      await this.storage.store(storageKey, buffer, record.scope === 'db_files' ? 'application/gzip' : 'application/gzip');

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
      unlink(tmpDir).catch(() => {});
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

    // Update checksum
    const data = await import('fs/promises').then(fs => fs.readFile(outputPath));
    checksum.update(data);
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

    const buffer = await this.storage.read(job.fileKey);
    const filename = job.fileKey.split('/').pop() || `backup-${id}.sql.gz`;
    const mimeType = job.scope === 'db_files' ? 'application/gzip' : 'application/gzip';
    return { stream: Readable.from(buffer), filename, mimeType };
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
    // Create a temporary backup record
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
    await import('fs/promises').then(fs => fs.writeFile(tmpPath, fileBuffer));

    this.runRestorePipeline(job.id, { tmpPath, isUpload: true }).catch((err) => {
      this.logger.error(`Upload restore ${job.id} failed: ${err.message}`);
      this.prisma.backupJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMessage: err.message },
      }).catch(() => {});
    });

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
        // Download from storage
        const job = await this.prisma.backupJob.findUnique({ where: { id: backupId } });
        if (!job?.fileKey) throw new Error('No backup file');
        const buffer = await this.storage.read(job.fileKey);
        tmpPath = join(tmpDir, job.fileKey.split('/').pop()!);
        await import('fs/promises').then(fs => fs.writeFile(tmpPath, buffer));
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
      unlink(tmpDir).catch(() => {});
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
    const cron = await this.getSetting('backup_schedule_cron', '0 2 * * *');

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
```

- [ ] **Backend build check**

```bash
npm run build --workspace=backend
```

- [ ] **Commit**

```bash
git add apps/backend/src/backup/
git commit -m "feat: add BackupService with pg_dump/psql pipeline"
```

---

### Task 3: Backup Controller + DTOs

**Files:**
- Create: `apps/backend/src/backup/dto/create-backup.dto.ts`
- Create: `apps/backend/src/backup/dto/restore-backup.dto.ts`
- Create: `apps/backend/src/backup/backup.controller.ts`
- Modify: `apps/backend/src/backup/backup.module.ts` (add controller)

- [ ] **Create `dto/create-backup.dto.ts`**

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateBackupDto {
  @IsIn(['db_only', 'db_files'])
  scope: 'db_only' | 'db_files';
}
```

- [ ] **Create `backup.controller.ts`**

```ts
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Res, Req,
  BadRequestException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { BackupService } from './backup.service';
import { CreateBackupDto } from './dto/create-backup.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/backup')
@Roles('superadmin', 'admin')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  async list(@Query() query: any) {
    return this.backup.listBackups(query);
  }

  @Post()
  async create(@Body() dto: CreateBackupDto) {
    return this.backup.triggerManual(dto.scope);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.backup.getBackup(id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() reply: FastifyReply) {
    const { stream, filename, mimeType } = await this.backup.downloadBackup(id);
    reply.header('Content-Type', mimeType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(stream);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    return this.backup.restoreFromBackup(id);
  }

  @Post('restore/upload')
  async uploadRestore(@Req() req: FastifyRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException('File required');

    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 5GB limit');
    }

    const name = file.filename;
    if (!name.endsWith('.sql.gz') && !name.endsWith('.tar.gz')) {
      throw new BadRequestException('File must be .sql.gz or .tar.gz');
    }

    return this.backup.restoreFromUpload(buffer, name);
  }

  @Patch(':id/lock')
  async toggleLock(@Param('id') id: string, @Body() body: { locked: boolean }) {
    await this.backup.toggleLock(id, body.locked);
    return { success: true };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.backup.deleteBackup(id);
    return { success: true };
  }

  @Get('settings')
  async getSettings() {
    return this.backup.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() body: Record<string, string>) {
    await this.backup.updateSettings(body);
    return { success: true };
  }
}
```

- [ ] **Update `backup.module.ts`** — add controller:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'backup' }),
  ],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
```

- [ ] **Build check**

```bash
npm run build --workspace=backend
```

- [ ] **Commit**

```bash
git add apps/backend/src/backup/
git commit -m "feat: add BackupController with REST endpoints"
```

---

### Task 4: Backup BullMQ Processor + Wire Module into App

**Files:**
- Create: `apps/backend/src/backup/backup-job.processor.ts`
- Create: `apps/backend/src/backup/backup-job.constant.ts`
- Modify: `apps/backend/src/backup/backup.module.ts` (add processor)
- Modify: `apps/backend/src/backup/backup.service.ts` (add onModuleInit)
- Modify: `apps/backend/src/app.module.ts` or root module (import BackupModule)

- [ ] **Create `backup-job.constant.ts`**

```ts
export const BACKUP_QUEUE = 'backup';
export const BACKUP_JOB = 'backup';
export const SCHEDULED_BACKUP_JOB = 'scheduled-backup';
```

- [ ] **Create `backup-job.processor.ts`**

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BackupService } from './backup.service';

interface BackupJobData {
  backupId?: string;
  scope?: 'db_only' | 'db_files';
  type?: 'manual' | 'scheduled';
}

@Processor('backup')
export class BackupJobProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupJobProcessor.name);

  constructor(private readonly backup: BackupService) {
    super();
  }

  async process(job: Job<BackupJobData>): Promise<void> {
    const data = job.data;

    if (data.backupId) {
      // Manual trigger — run specific backup
      await this.backup.runBackupPipeline(data.backupId);
    } else if (data.type === 'scheduled') {
      // Scheduled trigger — create new backup then run
      const { id } = await this.backup.triggerManual(data.scope || 'db_only');
      // The triggerManual already added a queue job with backupId
    }
  }
}
```

- [ ] **Update `backup.module.ts`** — add processor + Lifecycle hook:

```ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupJobProcessor } from './backup-job.processor';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'backup' }),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupJobProcessor],
  exports: [BackupService],
})
export class BackupModule {}
```

- [ ] **Find and read root AppModule to import BackupModule**

Need to find where modules are imported. Check if `AppsModule` or root module exists.

```bash
grep -rl "imports:" apps/backend/src/app.module.ts 2>/dev/null || grep -rl "Module" apps/backend/src/*.module.ts
```

Read the root module and add `BackupModule` to its `imports`.

```ts
import { BackupModule } from './backup/backup.module';
// Add to @Module.imports: BackupModule
```

- [ ] **Build check**

```bash
npm run build --workspace=backend
```

- [ ] **Commit**

```bash
git add apps/backend/src/backup/ apps/backend/src/*.module.ts
git commit -m "feat: add BackupJobProcessor + wire BackupModule into app"
```

---

### Task 5: Admin Frontend — API Client + Types + Hooks

**Files:**
- Create: `apps/admin/src/features/backup/api.ts`
- Create: `apps/admin/src/features/backup/types.ts`
- Create: `apps/admin/src/features/backup/hooks/index.ts`

- [ ] **Create `types.ts`**

```ts
export interface BackupJob {
  id: string;
  type: 'manual' | 'scheduled';
  scope: 'db_only' | 'db_files';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'restoring';
  fileKey: string | null;
  fileSize: number | null;
  checksum: string | null;
  dbDumpSize: number | null;
  filesSize: number | null;
  locked: boolean;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupListResponse {
  items: BackupJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BackupSettings {
  [key: string]: string;
}
```

- [ ] **Create `api.ts`**

```ts
import { apiClient } from '@/lib/api-client'
import type { BackupJob, BackupListResponse, BackupSettings } from './types'

export const backupApi = {
  list: (params?: Record<string, any>) =>
    apiClient.get<BackupListResponse>('/admin/backup', { params }).then((r) => r.data),

  get: (id: string) =>
    apiClient.get<BackupJob>(`/admin/backup/${id}`).then((r) => r.data),

  create: (scope: 'db_only' | 'db_files') =>
    apiClient.post<{ id: string }>('/admin/backup', { scope }).then((r) => r.data),

  download: (id: string) =>
    apiClient
      .get(`/admin/backup/${id}/download`, { responseType: 'blob' })
      .then((r) => r.data),

  restore: (id: string) =>
    apiClient.post<{ id: string }>(`/admin/backup/${id}/restore`).then((r) => r.data),

  uploadRestore: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient
      .post<{ id: string }>('/admin/backup/restore/upload', form)
      .then((r) => r.data)
  },

  toggleLock: (id: string, locked: boolean) =>
    apiClient.patch(`/admin/backup/${id}/lock`, { locked }).then((r) => r.data),

  delete: (id: string) =>
    apiClient.delete(`/admin/backup/${id}`).then((r) => r.data),

  getSettings: () =>
    apiClient.get<BackupSettings>('/admin/backup/settings').then((r) => r.data),

  updateSettings: (settings: BackupSettings) =>
    apiClient.put('/admin/backup/settings', settings).then((r) => r.data),
}
```

- [ ] **Create `hooks/index.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { backupApi } from '../api'

export function useBackups(params?: Record<string, any>) {
  return useQuery({
    queryKey: ['backups', params],
    queryFn: () => backupApi.list(params),
    refetchInterval: 30_000, // poll for status changes
  })
}

export function useBackup(id: string) {
  return useQuery({
    queryKey: ['backup', id],
    queryFn: () => backupApi.get(id),
    enabled: !!id,
  })
}

export function useTriggerBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scope: 'db_only' | 'db_files') => backupApi.create(scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useRestoreBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => backupApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useRestoreUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => backupApi.uploadRestore(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useToggleLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      backupApi.toggleLock(id, locked),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useDeleteBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => backupApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useBackupSettings() {
  return useQuery({
    queryKey: ['backup-settings'],
    queryFn: () => backupApi.getSettings(),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: Record<string, string>) => backupApi.updateSettings(settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-settings'] }),
  })
}
```

- [ ] **Build check**

```bash
npm run build --workspace=admin
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/backup/
git commit -m "feat: add backup API client, types, and React Query hooks"
```

---

### Task 6: Admin Frontend — Backup Components

**Files:**
- Create: `apps/admin/src/features/backup/components/BackupTable.tsx`
- Create: `apps/admin/src/features/backup/components/RunBackupDialog.tsx`
- Create: `apps/admin/src/features/backup/components/RestoreConfirmDialog.tsx`
- Create: `apps/admin/src/features/backup/components/UploadRestoreDialog.tsx`
- Create: `apps/admin/src/features/backup/components/BackupSettingsForm.tsx`
- Create: `apps/admin/src/features/backup/components/BackupStats.tsx`

- [ ] **Create `BackupTable.tsx`**

```tsx
import { useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDistanceToNow, format } from 'date-fns'
import { Download, Lock, Unlock, Trash2, RotateCcw, FileDown } from 'lucide-react'
import type { BackupJob } from '../types'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  restoring: 'bg-orange-500',
}

const SCOPE_LABELS: Record<string, string> = {
  db_only: 'DB Only',
  db_files: 'DB + Files',
}

interface Props {
  backups: BackupJob[]
  isLoading: boolean
  totalPages: number
  page: number
  onPageChange: (p: number) => void
  onDownload: (id: string) => void
  onRestore: (id: string) => void
  onToggleLock: (id: string, locked: boolean) => void
  onDelete: (id: string) => void
}

export function BackupTable({
  backups, isLoading, totalPages, page, onPageChange,
  onDownload, onRestore, onToggleLock, onDelete,
}: Props) {
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading...</div>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backups</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No backups yet
                </TableCell>
              </TableRow>
            ) : (
              backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-xs">
                    <div>{format(new Date(b.createdAt), 'PP')}</div>
                    <div className="text-muted-foreground">
                      {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{b.type}</TableCell>
                  <TableCell>{SCOPE_LABELS[b.scope] || b.scope}</TableCell>
                  <TableCell>
                    <Badge className={`${STATUS_COLORS[b.status]} text-white`}>
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {b.fileSize ? `${(Number(b.fileSize) / 1024 / 1024).toFixed(1)} MB` : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {b.status === 'completed' && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => onDownload(b.id)}
                            title="Download">
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => onRestore(b.id)}
                            title="Restore">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => onToggleLock(b.id, !b.locked)}
                        title={b.locked ? 'Unlock' : 'Lock'}>
                        {b.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => onDelete(b.id)}
                        title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <Button variant="outline" size="sm"
              disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </Button>
            <span className="flex items-center text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm"
              disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Create `RunBackupDialog.tsx`**

```tsx
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Plus } from 'lucide-react'

interface Props {
  onRun: (scope: 'db_only' | 'db_files') => void
  isPending: boolean
}

export function RunBackupDialog({ onRun, isPending }: Props) {
  const [scope, setScope] = useState<'db_only' | 'db_files'>('db_only')
  const [open, setOpen] = useState(false)

  const handleRun = () => {
    onRun(scope)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Run Backup</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Manual Backup</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <RadioGroup value={scope} onValueChange={(v: any) => setScope(v)}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="db_only" id="db_only" />
              <Label htmlFor="db_only">Database Only — faster, smaller</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="db_files" id="db_files" />
              <Label htmlFor="db_files">Database + Content Files — full backup</Label>
            </div>
          </RadioGroup>
          <Button onClick={handleRun} disabled={isPending} className="w-full">
            {isPending ? 'Starting...' : 'Start Backup'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Create `RestoreConfirmDialog.tsx`**

```tsx
import { useState } from 'react'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle } from 'lucide-react'

interface Props {
  onConfirm: () => void
  isPending: boolean
  trigger: React.ReactNode
}

export function RestoreConfirmDialog({ onConfirm, isPending, trigger }: Props) {
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const confirmed = typed === 'RESTORE'

  const handleConfirm = () => {
    onConfirm()
    setOpen(false)
    setTyped('')
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" /> Restore Backup
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will OVERWRITE your current database with the backup data.
            This action cannot be undone. Type <strong>RESTORE</strong> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          placeholder='Type "RESTORE" to confirm'
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!confirmed || isPending}
            onClick={handleConfirm}
          >
            {isPending ? 'Restoring...' : 'Restore Now'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Create `UploadRestoreDialog.tsx`**

```tsx
import { useState, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Upload, File } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  onUpload: (file: File) => void
  isPending: boolean
}

export function UploadRestoreDialog({ onUpload, isPending }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = () => {
    if (file) {
      onUpload(file)
      setOpen(false)
      setFile(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="mr-2 h-4 w-4" />Upload & Restore</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-600">
            <AlertTriangle className="h-5 w-5" /> Upload Backup & Restore
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary"
            onClick={() => inputRef.current?.click()}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <File className="h-5 w-5" />
                <span>{file.name}</span>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Click to select .sql.gz or .tar.gz file
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".sql.gz,.tar.gz"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This will overwrite your database. Max 5GB.
          </p>
          <Button onClick={handleUpload} disabled={!file || isPending} className="w-full">
            {isPending ? 'Restoring...' : 'Upload & Restore'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Create `BackupSettingsForm.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Save, Loader2 } from 'lucide-react'

interface Props {
  settings: Record<string, string> | undefined
  onSave: (settings: Record<string, string>) => void
  isPending: boolean
}

export function BackupSettingsForm({ settings, onSave, isPending }: Props) {
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings) setForm({ ...settings })
  }, [settings])

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => onSave(form)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="schedule_enabled">Automatic Backups</Label>
          <Switch
            id="schedule_enabled"
            checked={form['backup_schedule_enabled'] === 'true'}
            onCheckedChange={(v) => handleChange('backup_schedule_enabled', String(v))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cron">Schedule (cron)</Label>
          <Input
            id="cron"
            value={form['backup_schedule_cron'] || '0 2 * * *'}
            onChange={(e) => handleChange('backup_schedule_cron', e.target.value)}
            disabled={form['backup_schedule_enabled'] !== 'true'}
            placeholder="0 2 * * *"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="default_scope">Default Scope</Label>
          <select
            id="default_scope"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"
            value={form['backup_default_scope'] || 'db_only'}
            onChange={(e) => handleChange('backup_default_scope', e.target.value)}
          >
            <option value="db_only">Database Only</option>
            <option value="db_files">Database + Files</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="daily">Keep Daily</Label>
            <Input
              id="daily" type="number" min="0"
              value={form['backup_retention_daily'] || '7'}
              onChange={(e) => handleChange('backup_retention_daily', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weekly">Keep Weekly</Label>
            <Input
              id="weekly" type="number" min="0"
              value={form['backup_retention_weekly'] || '4'}
              onChange={(e) => handleChange('backup_retention_weekly', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthly">Keep Monthly</Label>
            <Input
              id="monthly" type="number" min="0" max="12"
              value={form['backup_retention_monthly'] || '3'}
              onChange={(e) => handleChange('backup_retention_monthly', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="yearly">Keep Yearly</Label>
            <Input
              id="yearly" type="number" min="0"
              value={form['backup_retention_yearly'] || '1'}
              onChange={(e) => handleChange('backup_retention_yearly', e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max_total">Max Total Backups</Label>
          <Input
            id="max_total" type="number" min="1"
            value={form['backup_max_total'] || '30'}
            onChange={(e) => handleChange('backup_max_total', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="include_paths">Include Paths (comma-separated)</Label>
          <Input
            id="include_paths"
            value={(() => {
              try {
                const v = form['backup_include_paths'];
                return v ? JSON.parse(v).join(', ') : 'uploads';
              } catch { return form['backup_include_paths'] || 'uploads'; }
            })()}
            onChange={(e) => handleChange('backup_include_paths',
              JSON.stringify(e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)))}
          />
        </div>

        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Settings
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Create `BackupStats.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HardDrive, Database, Clock, Shield } from 'lucide-react'
import type { BackupJob } from '../types'

interface Props {
  backups: BackupJob[] | undefined
  isLoading: boolean
}

export function BackupStats({ backups, isLoading }: Props) {
  if (isLoading || !backups) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardHeader><CardTitle className="text-sm animate-pulse bg-muted h-4 w-20 rounded" /></CardHeader></Card>
        ))}
      </div>
    )
  }

  const total = backups.length
  const completed = backups.filter((b) => b.status === 'completed').length
  const totalSize = backups.reduce((acc, b) => acc + (Number(b.fileSize) || 0), 0)
  const locked = backups.filter((b) => b.locked).length
  const lastBackup = backups.find((b) => b.status === 'completed')

  const stats = [
    { icon: Database, label: 'Total Backups', value: String(total) },
    { icon: HardDrive, label: 'Total Size', value: `${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB` },
    { icon: Clock, label: 'Last Backup', value: lastBackup
      ? new Date(lastBackup.createdAt).toLocaleDateString() : 'Never' },
    { icon: Shield, label: 'Locked', value: String(locked) },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
            <s.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Build check**

```bash
npm run build --workspace=admin
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/backup/components/
git commit -m "feat: add backup UI components"
```

---

### Task 7: Admin Frontend — Route Pages + Wire Up

**Files:**
- Create: `apps/admin/src/features/backup/backup-index.tsx` — main backup page
- Create: `apps/admin/src/features/backup/backup-settings.tsx` — settings page
- Create: `apps/admin/src/routes/_authenticated/mon/backup/index.tsx`
- Create: `apps/admin/src/routes/_authenticated/mon/backup/settings.tsx`

- [ ] **Create `backup-index.tsx`** — main page composing all components

```tsx
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useBackups, useTriggerBackup, useRestoreBackup,
  useRestoreUpload, useToggleLock, useDeleteBackup } from './hooks'
import { BackupTable } from './components/BackupTable'
import { BackupStats } from './components/BackupStats'
import { RunBackupDialog } from './components/RunBackupDialog'
import { UploadRestoreDialog } from './components/UploadRestoreDialog'
import { apiClient } from '@/lib/api-client'

export function BackupPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useBackups({ page, limit: 20 })
  const trigger = useTriggerBackup()
  const restore = useRestoreBackup()
  const uploadRestore = useRestoreUpload()
  const toggleLock = useToggleLock()
  const deleteBackup = useDeleteBackup()

  const handleDownload = useCallback(async (id: string) => {
    try {
      const response = await apiClient.get(`/admin/backup/${id}/download`, {
        responseType: 'blob',
      })
      const disposition = response.headers['content-disposition'] || ''
      const match = disposition.match(/filename="?(.+?)"?$/)
      const filename = match?.[1] || `backup-${id}.sql.gz`
      const url = URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    }
  }, [])

  const handleRestore = useCallback((id: string) => {
    restore.mutate(id, {
      onSuccess: () => toast.success('Restore started'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Restore failed'),
    })
  }, [restore])

  const handleToggleLock = useCallback((id: string, locked: boolean) => {
    toggleLock.mutate({ id, locked })
  }, [toggleLock])

  const handleDelete = useCallback((id: string) => {
    if (window.confirm('Delete this backup permanently?')) {
      deleteBackup.mutate(id, {
        onSuccess: () => toast.success('Backup deleted'),
      })
    }
  }, [deleteBackup])

  const handleUploadRestore = useCallback((file: File) => {
    uploadRestore.mutate(file, {
      onSuccess: () => toast.success('Upload restore started'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Upload restore failed'),
    })
  }, [uploadRestore])

  const handleRunBackup = useCallback((scope: 'db_only' | 'db_files') => {
    trigger.mutate(scope, {
      onSuccess: () => toast.success('Backup started'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Backup failed'),
    })
  }, [trigger])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Backup & Restore</h1>
        <div className="flex gap-2">
          <UploadRestoreDialog onUpload={handleUploadRestore} isPending={uploadRestore.isPending} />
          <RunBackupDialog onRun={handleRunBackup} isPending={trigger.isPending} />
        </div>
      </div>

      <BackupStats backups={data?.items} isLoading={isLoading} />

      <BackupTable
        backups={data?.items || []}
        isLoading={isLoading}
        totalPages={data?.totalPages || 1}
        page={page}
        onPageChange={setPage}
        onDownload={handleDownload}
        onRestore={handleRestore}
        onToggleLock={handleToggleLock}
        onDelete={handleDelete}
      />
    </div>
  )
}
```

- [ ] **Create route file `_authenticated/mon/backup/index.tsx`**

```ts
import { createFileRoute } from '@tanstack/react-router'
import { BackupPage } from '@/features/backup/backup-index'

export const Route = createFileRoute('/_authenticated/mon/backup/')({
  component: BackupPage,
})
```

- [ ] **Create `backup-settings.tsx`** — settings page

```tsx
import { useBackupSettings, useUpdateSettings } from './hooks'
import { BackupSettingsForm } from './components/BackupSettingsForm'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

export function BackupSettingsPage() {
  const { data: settings, isLoading } = useBackupSettings()
  const update = useUpdateSettings()

  const handleSave = (data: Record<string, string>) => {
    update.mutate(data, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to save settings'),
    })
  }

  return (
    <>
      <Header title="Backup Settings" />
      <Main>
        <BackupSettingsForm
          settings={settings}
          onSave={handleSave}
          isPending={update.isPending}
        />
      </Main>
    </>
  )
}
```

- [ ] **Create route file `_authenticated/mon/backup/settings.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { BackupSettingsPage } from '@/features/backup/backup-settings'

export const Route = createFileRoute('/_authenticated/mon/backup/settings')({
  component: BackupSettingsPage,
})
```

- [ ] **Build check**

```bash
npm run build --workspace=admin
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/backup/ apps/admin/src/routes/_authenticated/mon/backup/
git commit -m "feat: add backup route pages and wire up components"
```

---

### Task 8: Final Verification

- [ ] **Full monorepo build**

```bash
npm run build
```

- [ ] **Fix any TypeScript/build errors**

- [ ] **Final commit if needed**

```bash
git add -A && git commit -m "fix: resolve build issues after backup feature"
```

---

### Task 9: Add backup menu link to mon sidebar

**Files:**
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`

- [ ] **Add backup entry to monitoring panel**

In `sidebar-data.ts`, after the Security Dashboard line (line 134), add:

```ts
{ title: 'Backup & Restore', url: '/mon/backup', icon: ShieldCheck },
```

This will appear in the monitoring panel's navigation sidebar below Security Dashboard.

- [ ] **Build check**

```bash
npm run build --workspace=admin
```

- [ ] **Commit**

```bash
git add apps/admin/src/components/layout/data/sidebar-data.ts
git commit -m "feat: add backup link to mon navigation sidebar"
```
