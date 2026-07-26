import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { Client } from 'pg';
import { parseExpression } from 'cron-parser';
import { execFile } from 'child_process';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import {
  mkdir,
  open,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { tmpdir } from 'os';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createGzip, createGunzip } from 'zlib';
import { CacheService } from '../cache/cache.service';
import { MediaQueueService } from '../media/media-queue/media-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_FILENAME,
  BACKUP_SQL_FILENAME,
  type ArchiveValidation,
  type BackupManifest,
  extractValidatedTarBackup,
  finalizeInterruptedContentRestore,
  listInterruptedContentRestoreIds,
  normalizeBackupIncludePaths,
  prepareBackupContentRestore,
  readBackupManifest,
  resolveBackupContent,
  rollbackInterruptedContentRestore,
  validateTarBackup,
} from './backup-archive';

const execFileAsync = promisify(execFile);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const DEFAULT_BACKUP_DOWNLOAD_TTL_MS = 60 * 60 * 1000;
const BACKUP_LIFECYCLE_ADVISORY_LOCK = 19_504_221_987_541n;
const BACKUP_MAINTENANCE_CACHE_KEY = 'system:backup-maintenance';
const RESTORE_CONTROL_SCHEMA = 'ecomate_control';
const RESTORE_CONTROL_TABLE = 'backup_restore_operation';
const MAX_UPLOADED_SQL_LINE_BYTES = 1024 * 1024;
const MAX_UPLOADED_SQL_STATEMENT_BYTES = 4 * 1024 * 1024;

export interface BackupListQuery {
  page?: number | string;
  limit?: number | string;
  search?: string;
  type?: string;
  scope?: string;
  status?: string;
}

interface ParsedDbUrl {
  database: string;
  host: string;
  port: string;
  user: string;
  password: string;
  sslMode?: string;
}

interface RestoreOptions {
  tmpPath?: string;
  uploadTmpDir?: string;
  sourceSnapshot?: any;
  preserveSourceOnFailure: boolean;
}

interface DownloadByteRange {
  start: number;
  end: number;
  total: bigint;
}

interface MaintenanceLease {
  owner: string;
  active: boolean;
  timer: NodeJS.Timeout | null;
}

type RestoreControlPhase =
  | 'preparing'
  | 'database_committed'
  | 'failed_after_commit';

interface RestoreControlOperation {
  operationId: string;
  phase: RestoreControlPhase;
  executionRole: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  catalogSnapshots: Array<Record<string, unknown>>;
}

export interface QueuedRestoreData {
  operation: 'restore';
  backupId: string;
  sourceSnapshot: Record<string, unknown>;
  tmpPath?: string;
  uploadTmpDir?: string;
  preserveSourceOnFailure: boolean;
}

export interface LegacyBackupMigrationData {
  operation: 'migrate-legacy';
  backupId: string;
  legacyKey: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveBigInt(value: string | undefined, fallback: bigint): bigint {
  try {
    const parsed = BigInt(value || '');
    return parsed > 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseDbUrl(url: string): ParsedDbUrl {
  const parsed = new URL(url);
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    sslMode: parsed.searchParams.get('sslmode') || undefined,
  };
}

function postgresEnv(parsed: ParsedDbUrl): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGPASSWORD: parsed.password,
    ...(parsed.sslMode ? { PGSSLMODE: parsed.sslMode } : {}),
  };
}

function quotePgIdentifier(value: string): string {
  if (!value) throw new Error('PostgreSQL identifier cannot be empty');
  return `"${value.replace(/"/g, '""')}"`;
}

function quotePgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 10_000);
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly dbDumpTimeout = positiveInteger(
    process.env.BACKUP_DUMP_TIMEOUT,
    30 * 60 * 1000,
  );
  private readonly archiveTimeout = positiveInteger(
    process.env.BACKUP_ARCHIVE_TIMEOUT,
    2 * 60 * 60 * 1000,
  );
  private readonly restoreTimeout = positiveInteger(
    process.env.BACKUP_RESTORE_TIMEOUT,
    24 * 60 * 60 * 1000,
  );
  private readonly maxRestoreBytes = positiveBigInt(
    process.env.BACKUP_MAX_RESTORE_BYTES,
    100n * 1024n * 1024n * 1024n,
  );
  private readonly maxArchiveEntries = positiveInteger(
    process.env.BACKUP_MAX_ARCHIVE_ENTRIES,
    1_000_000,
  );
  private readonly maxDecompressionRatio = positiveInteger(
    process.env.BACKUP_MAX_DECOMPRESSION_RATIO,
    1000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaQueue: MediaQueueService,
    private readonly cache: CacheService,
    @InjectQueue('backup') private readonly backupQueue: Queue,
    @InjectQueue('email') private readonly emailQueue: Queue,
    @InjectQueue('import') private readonly importQueue: Queue,
    @InjectQueue('tracking') private readonly trackingQueue: Queue,
    @InjectQueue('security-events')
    private readonly securityEventsQueue: Queue,
    @InjectQueue('security-aggregate')
    private readonly securityAggregateQueue: Queue,
  ) {}

  private maintenanceQueues(): Queue[] {
    return [
      this.emailQueue,
      this.importQueue,
      this.trackingQueue,
      this.securityEventsQueue,
      this.securityAggregateQueue,
    ];
  }

  private async pauseMaintenanceQueuesAndDrain(): Promise<void> {
    const queues = this.maintenanceQueues();
    await Promise.all(queues.map((queue) => queue.pause()));
    const deadline =
      Date.now() +
      positiveInteger(
        process.env.BACKUP_QUEUE_DRAIN_TIMEOUT,
        2 * 60 * 60 * 1000,
      );
    while (true) {
      const counts = await Promise.all(
        queues.map((queue) => queue.getActiveCount()),
      );
      const active = counts.reduce((total, count) => total + count, 0);
      if (active === 0) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${active} active background job(s) before backup maintenance`,
        );
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }

  private async resumeMaintenanceQueues(): Promise<void> {
    const results = await Promise.allSettled(
      this.maintenanceQueues().map((queue) => queue.resume()),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }

  private async setRestoreControlPhase(
    operationId: string,
    phase: RestoreControlPhase,
    executionRole: string | null = null,
  ): Promise<void> {
    if (phase === 'preparing') {
      const inserted = await this.prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "ecomate_control"."backup_restore_operation"
            ("operation_id", "phase", "execution_role", "updated_at")
          VALUES (
            ${operationId},
            'preparing',
            ${executionRole},
            clock_timestamp()
          )
          ON CONFLICT ("operation_id") DO NOTHING
        `,
      );
      if (inserted !== 1) {
        throw new ConflictException(
          'This restore already has durable recovery state; reconcile it before retrying',
        );
      }
      return;
    }

    const updated = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "ecomate_control"."backup_restore_operation"
        SET
          "phase" = ${phase},
          "execution_role" = COALESCE(${executionRole}, "execution_role"),
          "updated_at" = clock_timestamp()
        WHERE "operation_id" = ${operationId}
      `,
    );
    if (updated !== 1) {
      throw new Error(
        `Restore control row ${operationId} is missing while setting ${phase}`,
      );
    }
  }

  private async listRestoreControlOperations(): Promise<
    RestoreControlOperation[]
  > {
    return this.prisma.$queryRaw<RestoreControlOperation[]>(
      Prisma.sql`
        SELECT
          "operation_id" AS "operationId",
          "phase",
          "execution_role" AS "executionRole",
          "source_snapshot" AS "sourceSnapshot",
          "catalog_snapshots" AS "catalogSnapshots"
        FROM "ecomate_control"."backup_restore_operation"
        ORDER BY "updated_at" ASC
      `,
    );
  }

  private async getRestoreControlOperation(
    operationId: string,
  ): Promise<RestoreControlOperation | null> {
    const rows = await this.prisma.$queryRaw<RestoreControlOperation[]>(
      Prisma.sql`
        SELECT
          "operation_id" AS "operationId",
          "phase",
          "execution_role" AS "executionRole",
          "source_snapshot" AS "sourceSnapshot",
          "catalog_snapshots" AS "catalogSnapshots"
        FROM "ecomate_control"."backup_restore_operation"
        WHERE "operation_id" = ${operationId}
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  }

  private async getActiveRestoreControl(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ operationId: string; phase: RestoreControlPhase } | null> {
    const rows = await client.$queryRaw<
      Array<{ operationId: string; phase: RestoreControlPhase }>
    >(
      Prisma.sql`
        SELECT
          "operation_id" AS "operationId",
          "phase"
        FROM "ecomate_control"."backup_restore_operation"
        ORDER BY "updated_at" ASC
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  }

  private async setRestoreControlSnapshots(
    operationId: string,
    sourceSnapshot: Record<string, unknown>,
    catalogSnapshots: Array<Record<string, unknown>>,
  ): Promise<void> {
    const sourceJson = JSON.stringify(sourceSnapshot);
    const catalogJson = JSON.stringify(catalogSnapshots);
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "ecomate_control"."backup_restore_operation"
        SET
          "source_snapshot" = ${sourceJson}::jsonb,
          "catalog_snapshots" = ${catalogJson}::jsonb,
          "updated_at" = clock_timestamp()
        WHERE "operation_id" = ${operationId}
      `,
    );
    if (updated !== 1) {
      throw new Error(
        `Restore control row ${operationId} disappeared before its catalog snapshot was saved`,
      );
    }
  }

  private async clearRestoreControlOperation(
    operationId: string,
  ): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM "ecomate_control"."backup_restore_operation"
        WHERE "operation_id" = ${operationId}
      `,
    );
  }

  private async backupWorkRoot(): Promise<string> {
    const root = resolve(process.env.BACKUP_WORK_DIR || tmpdir());
    await mkdir(root, { recursive: true });
    return root;
  }

  private async assertWorkingSpace(
    directory: string,
    requiredBytes: bigint,
    operation: string,
  ): Promise<void> {
    const filesystem = await statfs(directory, { bigint: true });
    const available = filesystem.bavail * filesystem.bsize;
    const reserve = 512n * 1024n * 1024n;
    if (available < requiredBytes + reserve) {
      throw new Error(
        `${operation} needs approximately ${requiredBytes.toString()} free bytes plus a 512MB safety reserve; only ${available.toString()} bytes are available`,
      );
    }
  }

  private async enterMaintenance(
    mode: 'full_backup' | 'restore',
  ): Promise<MaintenanceLease> {
    const lease: MaintenanceLease = {
      owner: randomUUID(),
      active: true,
      timer: null,
    };
    const ttl = 5 * 60 * 1000;
    const renew = async () => {
      if (!lease.active) return;
      try {
        await this.cache.set(
          BACKUP_MAINTENANCE_CACHE_KEY,
          {
            mode,
            owner: lease.owner,
            startedAt: new Date().toISOString(),
          },
          ttl,
        );
      } catch (error) {
        this.logger.error(
          `Could not renew backup maintenance lease: ${safeErrorMessage(error)}`,
        );
      }
      if (!lease.active) return;
      lease.timer = setTimeout(() => void renew(), 60_000);
      lease.timer.unref();
    };
    await renew();
    try {
      await this.waitForActiveWritesToDrain();
      return lease;
    } catch (error) {
      await this.leaveMaintenance(lease).catch(() => {});
      throw error;
    }
  }

  private async waitForActiveWritesToDrain(): Promise<void> {
    const timeout = positiveInteger(
      process.env.BACKUP_WRITE_DRAIN_TIMEOUT,
      2 * 60 * 60 * 1000,
    );
    const deadline = Date.now() + timeout;
    while (true) {
      const activeWrites = await this.cache.countByPrefix(
        'system:backup-active-write:',
        { requireShared: true },
      );
      if (activeWrites === 0) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${activeWrites} in-flight write request(s) before backup maintenance`,
        );
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }

  private async leaveMaintenance(
    lease?: MaintenanceLease | null,
  ): Promise<void> {
    if (lease) {
      lease.active = false;
      if (lease.timer) clearTimeout(lease.timer);
      const current = await this.cache.get<{ owner?: string }>(
        BACKUP_MAINTENANCE_CACHE_KEY,
      );
      if (current?.owner && current.owner !== lease.owner) return;
    }
    await this.cache.delete(BACKUP_MAINTENANCE_CACHE_KEY);
  }

  private startLifecycleHeartbeat(
    backupId: string,
    statuses: string[],
  ): () => Promise<void> {
    let active = true;
    let inFlight: Promise<unknown> = Promise.resolve();
    const timer = setInterval(() => {
      if (!active) return;
      inFlight = this.prisma.backupJob
        .updateMany({
          where: { id: backupId, status: { in: statuses } },
          data: { updatedAt: new Date() },
        })
        .catch((error) => {
          this.logger.warn(
            `Could not renew lifecycle heartbeat for ${backupId}: ${safeErrorMessage(error)}`,
          );
        });
    }, 30_000);
    timer.unref();
    return async () => {
      active = false;
      clearInterval(timer);
      await inFlight;
    };
  }

  private async createBackupJob(
    scope: 'db_only' | 'db_files',
    type: 'manual' | 'scheduled' | 'safety',
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.backupJob.create({
      data: { type, scope, status: 'pending' },
    });
  }

  private async enqueueBackup(
    scope: 'db_only' | 'db_files',
    type: 'manual' | 'scheduled',
  ): Promise<{ id: string }> {
    const record = await this.withLifecycleLock(async (tx) => {
      const durableRestore = await this.getActiveRestoreControl(tx);
      if (durableRestore) {
        throw new ConflictException(
          `Restore ${durableRestore.operationId} is still in ${durableRestore.phase} recovery`,
        );
      }
      const activeRestore = await tx.backupJob.findFirst({
        where: { status: 'restoring' },
        select: { id: true },
      });
      if (activeRestore) {
        throw new ConflictException('A restore is in progress');
      }
      return this.createBackupJob(scope, type, tx);
    });
    try {
      await this.backupQueue.add(
        'backup',
        { backupId: record.id },
        {
          jobId: `backup-${record.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    } catch (error) {
      await this.prisma.backupJob
        .update({
          where: { id: record.id },
          data: {
            status: 'failed',
            errorMessage: `Failed to enqueue backup: ${safeErrorMessage(error)}`,
          },
        })
        .catch(() => {});
      throw error;
    }
    return { id: record.id };
  }

  /**
   * Backup/restore status checks must be serialized across API and worker
   * processes. A process-local mutex still permits two replicas to start a
   * destructive restore at the same time, while this transaction-scoped
   * PostgreSQL lock protects the shared database without schema changes.
   */
  private async withLifecycleLock<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    timeoutMs = 30_000,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${BACKUP_LIFECYCLE_ADVISORY_LOCK.toString()})`,
        );
        return action(tx);
      },
      { maxWait: 30_000, timeout: timeoutMs },
    );
  }

  /**
   * Bull can redeliver a stalled job while the original worker is still alive.
   * A session-level PostgreSQL advisory lock fences the entire long-running
   * pipeline across replicas, not merely its short admission transaction.
   */
  private async withOperationFence<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL is not configured');
    const parsed = parseDbUrl(dbUrl);
    const client = new Client({
      host: parsed.host,
      port: Number(parsed.port),
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      application_name:
        operation === 'restore'
          ? 'ecomate-backup-restore'
          : 'ecomate-backup-operation',
      ...(parsed.sslMode && parsed.sslMode !== 'disable'
        ? { ssl: { rejectUnauthorized: parsed.sslMode === 'verify-full' } }
        : {}),
    });
    const fenceKey = createHash('sha256')
      .update(`ecomate:${operation}`)
      .digest()
      .readBigInt64BE(0)
      .toString();

    await client.connect();
    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [fenceKey],
      );
      if (!result.rows[0]?.acquired) {
        throw new ConflictException(
          `Another worker owns the ${operation} pipeline`,
        );
      }
      return await action();
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1::bigint)', [fenceKey])
        .catch(() => {});
      await client.end().catch(() => {});
    }
  }

  private serializeBackupSnapshot(snapshot: any): Record<string, unknown> {
    return {
      id: snapshot.id,
      type: snapshot.type,
      scope: snapshot.scope,
      status: snapshot.status,
      fileKey: snapshot.fileKey ?? null,
      fileSize: snapshot.fileSize?.toString() ?? null,
      checksum: snapshot.checksum ?? null,
      dbDumpSize: snapshot.dbDumpSize?.toString() ?? null,
      filesSize: snapshot.filesSize?.toString() ?? null,
      locked: snapshot.locked ?? false,
      errorMessage: snapshot.errorMessage ?? null,
      startedAt:
        snapshot.startedAt?.toISOString?.() ?? snapshot.startedAt ?? null,
      completedAt:
        snapshot.completedAt?.toISOString?.() ?? snapshot.completedAt ?? null,
      createdAt:
        snapshot.createdAt?.toISOString?.() ?? snapshot.createdAt ?? null,
    };
  }

  private deserializeBackupSnapshot(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    const bigintOrNull = (value: unknown) =>
      value === null || value === undefined ? null : BigInt(String(value));
    const dateOrNull = (value: unknown) =>
      value === null || value === undefined ? null : new Date(String(value));
    return {
      ...snapshot,
      fileSize: bigintOrNull(snapshot.fileSize),
      dbDumpSize: bigintOrNull(snapshot.dbDumpSize),
      filesSize: bigintOrNull(snapshot.filesSize),
      startedAt: dateOrNull(snapshot.startedAt),
      completedAt: dateOrNull(snapshot.completedAt),
      createdAt: dateOrNull(snapshot.createdAt),
    };
  }

  private async enqueueRestore(data: QueuedRestoreData): Promise<void> {
    await this.backupQueue.add('restore', data, {
      jobId: `restore-${data.backupId}-${randomUUID()}`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  async runQueuedRestore(data: QueuedRestoreData): Promise<void> {
    return this.withOperationFence('restore', async () => {
      await this.runQueuedRestoreOwned(data);
    });
  }

  private async runQueuedRestoreOwned(data: QueuedRestoreData): Promise<void> {
    const current = await this.prisma.backupJob.findUnique({
      where: { id: data.backupId },
      select: { status: true, errorMessage: true },
    });
    // A worker may be marked stalled after the pipeline committed but before
    // Bull recorded completion. The DB completion marker makes that replay a
    // safe no-op, especially for uploaded files already cleaned from disk.
    if (current?.status === 'completed' && !current.errorMessage) return;

    const sourceSnapshot = this.deserializeBackupSnapshot(data.sourceSnapshot);
    try {
      await this.runRestorePipeline(data.backupId, {
        tmpPath: data.tmpPath,
        uploadTmpDir: data.uploadTmpDir,
        sourceSnapshot,
        preserveSourceOnFailure: data.preserveSourceOnFailure,
      });
    } catch (error) {
      await this.handleRestoreFailure(
        sourceSnapshot,
        error,
        data.preserveSourceOnFailure,
      );
      throw error;
    }
  }

  async migrateLegacyBackup(data: LegacyBackupMigrationData): Promise<void> {
    return this.withOperationFence(
      `legacy:${data.backupId}`,
      async () => await this.migrateLegacyBackupOwned(data),
    );
  }

  private async migrateLegacyBackupOwned(
    data: LegacyBackupMigrationData,
  ): Promise<void> {
    const record = await this.prisma.backupJob.findUnique({
      where: { id: data.backupId },
    });
    if (!record) return;

    // A previous attempt may have published and switched the catalog before
    // failing only while deleting the old public object.
    if (!record.fileKey?.startsWith('backups/')) {
      await this.deleteLegacyArtifactEverywhere(data.legacyKey);
      await this.prisma.backupJob.update({
        where: { id: record.id },
        data: { errorMessage: null },
      });
      return;
    }

    await this.withLifecycleLock(async (tx) => {
      const durableRestore = await this.getActiveRestoreControl(tx);
      const activeRestore = await tx.backupJob.findFirst({
        where: { status: 'restoring' },
        select: { id: true },
      });
      const otherRunning = await tx.backupJob.findFirst({
        where: {
          status: 'running',
          id: { not: data.backupId },
        },
        select: { id: true },
      });
      if (durableRestore || activeRestore || otherRunning) {
        throw new ConflictException(
          'Legacy backup migration is waiting for the active backup/restore',
        );
      }
      await tx.backupJob.update({
        where: { id: data.backupId },
        data: { status: 'running', errorMessage: null },
      });
    });

    const newKey = this.storage.createBackupKey(
      data.backupId,
      basename(data.legacyKey),
    );
    try {
      let migratedChecksum: string | null = null;
      let lastReadError: unknown;
      for (const provider of await this.storage.legacyBackupProviders()) {
        const checksum = createHash('sha256');
        try {
          const source = await this.storage.readLegacyBackupStream(
            data.legacyKey,
            provider,
          );
          const hashingStream = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              checksum.update(chunk);
              callback(null, chunk);
            },
          });
          source.on('error', (error) => hashingStream.destroy(error));
          source.pipe(hashingStream);
          try {
            await this.storage.storeBackupStream(
              newKey,
              hashingStream,
              'application/gzip',
            );
          } finally {
            source.destroy();
          }

          const candidateChecksum = checksum.digest('hex');
          if (record.checksum && candidateChecksum !== record.checksum) {
            await this.storage.deleteBackup(newKey).catch(() => {});
            lastReadError = new Error(
              `Checksum mismatch in legacy ${provider} artifact`,
            );
            continue;
          }
          migratedChecksum = candidateChecksum;
          break;
        } catch (error) {
          lastReadError = error;
          await this.storage.deleteBackup(newKey).catch(() => {});
        }
      }
      if (!migratedChecksum) {
        throw lastReadError instanceof Error
          ? lastReadError
          : new Error(`Legacy backup artifact ${data.legacyKey} was not found`);
      }

      await this.prisma.backupJob.update({
        where: { id: record.id },
        data: {
          status: 'completed',
          fileKey: newKey,
          checksum: record.checksum || migratedChecksum,
          errorMessage: null,
        },
      });
      await this.deleteLegacyArtifactEverywhere(data.legacyKey);
    } catch (error) {
      const current = await this.prisma.backupJob
        .findUnique({ where: { id: record.id } })
        .catch(() => null);
      await this.prisma.backupJob
        .update({
          where: { id: record.id },
          data: {
            status: 'completed',
            errorMessage:
              current?.fileKey === newKey
                ? `Private copy is ready, but legacy public object cleanup failed (${data.legacyKey}): ${safeErrorMessage(error)}`
                : `Legacy private migration failed: ${safeErrorMessage(error)}`,
          },
        })
        .catch(() => {});
      throw error;
    }
  }

  private async deleteLegacyArtifactEverywhere(key: string): Promise<void> {
    const results = await Promise.allSettled(
      (await this.storage.legacyBackupProviders()).map((provider) =>
        this.storage.deleteLegacyBackup(key, provider),
      ),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      throw failures[0].reason;
    }
  }

  triggerManual(scope: 'db_only' | 'db_files'): Promise<{ id: string }> {
    return this.enqueueBackup(scope, 'manual');
  }

  triggerScheduled(scope: 'db_only' | 'db_files'): Promise<{ id: string }> {
    return this.enqueueBackup(scope, 'scheduled');
  }

  async runBackupPipeline(
    backupId: string,
    options: { allowDuringRestore?: boolean } = {},
  ): Promise<void> {
    return this.withOperationFence(`backup:${backupId}`, async () => {
      await this.runBackupPipelineOwned(backupId, options);
    });
  }

  private async runBackupPipelineOwned(
    backupId: string,
    options: { allowDuringRestore?: boolean } = {},
  ): Promise<void> {
    const record = await this.prisma.backupJob.findUnique({
      where: { id: backupId },
    });
    if (!record) throw new Error(`BackupJob ${backupId} not found`);
    if (record.status === 'completed' && record.fileKey) return;

    const admission = await this.withLifecycleLock(async (tx) => {
      const current = await tx.backupJob.findUnique({
        where: { id: backupId },
        select: { status: true, fileKey: true },
      });
      if (!current) {
        return { outcome: 'error' as const, message: 'Backup job not found' };
      }
      // Completed delivery is idempotent. A `running` status is deliberately
      // allowed here because Bull redelivers a stalled job after a worker
      // crash; treating it as success would leave the backup stuck forever.
      if (current.status === 'completed' && current.fileKey) {
        return { outcome: 'skip' as const };
      }

      const [running, restoring, durableRestore] = await Promise.all([
        tx.backupJob.findFirst({
          where: { status: 'running', id: { not: backupId } },
          select: { id: true },
        }),
        options.allowDuringRestore
          ? Promise.resolve(null)
          : tx.backupJob.findFirst({
              where: { status: 'restoring' },
              select: { id: true },
            }),
        options.allowDuringRestore
          ? Promise.resolve(null)
          : this.getActiveRestoreControl(tx),
      ]);

      if (running || restoring || durableRestore) {
        const message = running
          ? 'Another backup is already running'
          : durableRestore
            ? `Restore ${durableRestore.operationId} is still in ${durableRestore.phase} recovery`
            : 'A restore is in progress';
        await tx.backupJob.update({
          where: { id: backupId },
          data: { status: 'failed', errorMessage: message },
        });
        return { outcome: 'error' as const, message };
      }

      await tx.backupJob.update({
        where: { id: backupId },
        data: {
          status: 'running',
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        },
      });
      return { outcome: 'start' as const };
    });
    if (admission.outcome === 'skip') return;
    if (admission.outcome === 'error') {
      throw new ConflictException(admission.message);
    }

    const workDir = join(
      await this.backupWorkRoot(),
      `ecomate-backup-${backupId}`,
    );
    const ownsMaintenance =
      record.scope === 'db_files' && !options.allowDuringRestore;
    let mediaPaused = false;
    let backgroundQueuesPaused = false;
    let publishedStorageKey: string | null = null;
    let maintenanceLease: MaintenanceLease | null = null;
    let pipelineFailure: unknown = null;
    const stopHeartbeat = this.startLifecycleHeartbeat(backupId, ['running']);

    try {
      if (ownsMaintenance) {
        maintenanceLease = await this.enterMaintenance('full_backup');
        mediaPaused = true;
        await this.mediaQueue.pauseAndDrain();
        backgroundQueuesPaused = true;
        await this.pauseMaintenanceQueuesAndDrain();
      }
      await rm(workDir, { recursive: true, force: true });
      await mkdir(workDir, { recursive: true });
      const { dumpPath, dumpSize } = await this.createDbDump(workDir);
      let finalPath: string;
      let finalName: string;
      let filesSize: bigint | null = null;

      if (record.scope === 'db_files') {
        finalName = `backup-${backupId}.tar.gz`;
        finalPath = join(workDir, finalName);

        const configuredPaths = await this.getSettingJSON<unknown>(
          'backup_include_paths',
          ['uploads'],
        );
        const includePaths = normalizeBackupIncludePaths(configuredPaths);
        const uploadRoot = join(process.cwd(), 'uploads');
        await mkdir(uploadRoot, { recursive: true });
        const content = await resolveBackupContent(uploadRoot, includePaths);
        const storageConfig = await this.storage.getConfig();
        await this.assertWorkingSpace(
          workDir,
          content.filesSize * 2n + dumpSize * 3n,
          'Full backup',
        );

        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          version: BACKUP_FORMAT_VERSION,
          createdAt: new Date().toISOString(),
          scope: 'db_files',
          storageProvider: storageConfig.provider,
          contentLayout: 'uploads',
          localFilesIncluded: content.filesSize > 0n,
          includePaths: includePaths.map((path) =>
            path ? `uploads/${path}` : 'uploads',
          ),
          excludedPaths: ['uploads/backups'],
        };
        await writeFile(
          join(workDir, BACKUP_MANIFEST_FILENAME),
          JSON.stringify(manifest, null, 2),
          'utf8',
        );

        await this.createTarArchive(workDir, content.archivePaths, finalPath);
        await this.validateArchive(finalPath);
        filesSize = content.filesSize;
      } else {
        finalName = `backup-${backupId}.sql.gz`;
        finalPath = join(workDir, finalName);
        await this.assertWorkingSpace(
          workDir,
          dumpSize * 3n,
          'Database backup',
        );
        await pipeline(
          createReadStream(dumpPath),
          createGzip(),
          createWriteStream(finalPath, { flags: 'wx' }),
        );
      }

      const [finalChecksum, finalStat] = await Promise.all([
        this.hashFile(finalPath),
        stat(finalPath),
      ]);
      const storageKey = this.storage.createBackupKey(backupId, finalName);
      // Reserve the deterministic object key in the catalog before publishing
      // bytes. A crash or ambiguous storage response then leaves a visible,
      // deletable failed record instead of an orphaned multi-gigabyte object.
      await this.prisma.backupJob.update({
        where: { id: backupId },
        data: {
          // Keep the lifecycle reservation until maintenance and the media
          // queue have both been released in `finally`.
          status: 'running',
          fileKey: storageKey,
          fileSize: BigInt(finalStat.size),
          checksum: finalChecksum,
          dbDumpSize: dumpSize,
          filesSize,
          completedAt: null,
          errorMessage: null,
        },
      });
      publishedStorageKey = storageKey;
      await this.storage.storeBackupStream(
        storageKey,
        createReadStream(finalPath),
        'application/gzip',
      );
    } catch (error) {
      const message = safeErrorMessage(error);
      this.logger.error(`Backup ${backupId} failed: ${message}`);
      if (publishedStorageKey) {
        const current = await this.prisma.backupJob
          .findUnique({
            where: { id: backupId },
            select: { fileKey: true },
          })
          .catch(() => null);
        if (current?.fileKey !== publishedStorageKey) {
          await this.storage
            .deleteBackup(publishedStorageKey)
            .catch((cleanupError) => {
              this.logger.error(
                `Could not remove unpublished backup artifact ${publishedStorageKey}: ${safeErrorMessage(cleanupError)}`,
              );
            });
        }
      }
      pipelineFailure = error;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (mediaPaused) {
        await this.mediaQueue.resume().catch((error) => {
          this.logger.error(
            `Could not resume media processing: ${safeErrorMessage(error)}`,
          );
        });
      }
      if (backgroundQueuesPaused) {
        await this.resumeMaintenanceQueues().catch((error) => {
          this.logger.error(
            `Could not resume background queues: ${safeErrorMessage(error)}`,
          );
        });
      }
      if (ownsMaintenance && maintenanceLease) {
        await this.leaveMaintenance(maintenanceLease).catch((error) => {
          this.logger.error(
            `Could not clear backup maintenance flag: ${safeErrorMessage(error)}`,
          );
        });
      }
      await stopHeartbeat();
    }

    if (pipelineFailure) {
      await this.prisma.backupJob
        .update({
          where: { id: backupId },
          data: {
            status: 'failed',
            errorMessage: safeErrorMessage(pipelineFailure),
          },
        })
        .catch(() => {});
      // BullMQ retries only when the worker receives a rejection.
      throw pipelineFailure;
    }

    await this.prisma.backupJob.update({
      where: { id: backupId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        errorMessage: null,
      },
    });

    if (record.type === 'scheduled') {
      try {
        await this.performCleanup();
      } catch (error) {
        this.logger.error(
          `Backup ${backupId} completed, but retention cleanup failed: ${safeErrorMessage(error)}`,
        );
      }
    }
  }

  private async createDbDump(
    workDir: string,
  ): Promise<{ dumpPath: string; dumpSize: bigint }> {
    const dumpPath = join(workDir, BACKUP_SQL_FILENAME);
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new InternalServerErrorException('DATABASE_URL not configured');
    }

    const estimatedRows = await this.prisma.$queryRaw<
      Array<{ bytes: string }>
    >(
      Prisma.sql`
        SELECT COALESCE(SUM(pg_table_size(c.oid)), 0)::text AS "bytes"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'm', 'S')
      `,
    );
    const estimatedPublicBytes = BigInt(estimatedRows[0]?.bytes || '0');
    const dumpExpansionFactor = BigInt(
      positiveInteger(process.env.BACKUP_DUMP_SPACE_FACTOR, 2),
    );
    const minimumDumpSpace = positiveBigInt(
      process.env.BACKUP_MIN_DUMP_FREE_BYTES,
      256n * 1024n * 1024n,
    );
    const estimatedDumpSpace =
      estimatedPublicBytes * dumpExpansionFactor > minimumDumpSpace
        ? estimatedPublicBytes * dumpExpansionFactor
        : minimumDumpSpace;
    await this.assertWorkingSpace(
      workDir,
      estimatedDumpSpace,
      'Database dump',
    );

    const parsed = parseDbUrl(dbUrl);
    const args = [
      '--format=plain',
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      '--schema=public',
      '--exclude-schema=ecomate_control',
      '--host',
      parsed.host,
      '--port',
      parsed.port,
      '--username',
      parsed.user,
      '--dbname',
      parsed.database,
      '--file',
      dumpPath,
    ];

    const { stderr } = await execFileAsync('pg_dump', args, {
      env: postgresEnv(parsed),
      timeout: this.dbDumpTimeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (stderr && !stderr.includes('deprecated')) {
      this.logger.warn(`pg_dump warning: ${stderr.slice(0, 4000)}`);
    }

    const dumpStat = await stat(dumpPath);
    if (dumpStat.size === 0) throw new Error('pg_dump produced an empty file');
    if (BigInt(dumpStat.size) > this.maxRestoreBytes) {
      throw new Error(
        `Database dump exceeds the configured restore limit of ${this.maxRestoreBytes.toString()} bytes`,
      );
    }
    return { dumpPath, dumpSize: BigInt(dumpStat.size) };
  }

  private async createTarArchive(
    workDir: string,
    contentPaths: string[],
    outputPath: string,
  ): Promise<void> {
    const args = [
      '--create',
      '--gzip',
      '--file',
      outputPath,
      '--exclude=uploads/backups',
      '--exclude=uploads/backups/**',
      '--exclude=*.restore-*.tmp',
      '--exclude=uploads/.*.tmp',
      '--exclude=uploads/**/.*.tmp',
      '--exclude=uploads/.restore-staging-*',
      '--exclude=uploads/.restore-rollback-*',
      '--exclude=uploads/.restore-created-*',
      '--exclude=uploads/.restore-db-committed-*',
      '-C',
      workDir,
      BACKUP_SQL_FILENAME,
      BACKUP_MANIFEST_FILENAME,
    ];
    if (contentPaths.length > 0) {
      args.push('-C', process.cwd(), ...contentPaths);
    }

    await execFileAsync('tar', args, {
      timeout: this.archiveTimeout,
      maxBuffer: 8 * 1024 * 1024,
    });
  }

  private archiveValidationOptions() {
    return {
      maxEntries: this.maxArchiveEntries,
      maxExpandedBytes: this.maxRestoreBytes,
      maxDecompressionRatio: this.maxDecompressionRatio,
    };
  }

  private validateArchive(path: string): Promise<ArchiveValidation> {
    return validateTarBackup(path, this.archiveValidationOptions());
  }

  private async hashFile(path: string): Promise<string> {
    const checksum = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
      checksum.update(chunk as Buffer);
    }
    return checksum.digest('hex');
  }

  private async assertGzipFile(path: string): Promise<void> {
    const handle = await open(path, 'r');
    try {
      const header = Buffer.alloc(2);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== 2 || !header.equals(GZIP_MAGIC)) {
        throw new BadRequestException('Backup is not a valid gzip file');
      }
    } finally {
      await handle.close();
    }
  }

  async performCleanup(): Promise<number> {
    const values = await Promise.all([
      this.getSetting('backup_retention_daily', '7'),
      this.getSetting('backup_retention_weekly', '4'),
      this.getSetting('backup_retention_monthly', '3'),
      this.getSetting('backup_retention_yearly', '1'),
      this.getSetting('backup_max_total', '30'),
      this.getSetting('backup_retention_safety', '2'),
    ]);
    const [daily, weekly, monthly, yearly] = values
      .slice(0, 4)
      .map((value, i) =>
        nonNegativeInteger(value || undefined, [7, 4, 3, 1][i]),
      );
    const maxTotal = positiveInteger(values[4] || undefined, 30);
    const safetyLimit = nonNegativeInteger(values[5] || undefined, 2);

    let deleted = 0;
    const all = await this.prisma.backupJob.findMany({
      where: { status: 'completed', locked: false, type: 'scheduled' },
      orderBy: { completedAt: 'desc' },
    });

    const now = Date.now();
    const dayMs = 86_400_000;
    const buckets = {
      daily: [] as typeof all,
      weekly: [] as typeof all,
      monthly: [] as typeof all,
      yearly: [] as typeof all,
    };
    for (const backup of all) {
      if (!backup.completedAt) continue;
      const age = now - backup.completedAt.getTime();
      if (age < 7 * dayMs) buckets.daily.push(backup);
      else if (age < 31 * dayMs) buckets.weekly.push(backup);
      else if (age < 365 * dayMs) buckets.monthly.push(backup);
      else buckets.yearly.push(backup);
    }

    const limits: Record<keyof typeof buckets, number> = {
      daily,
      weekly,
      monthly,
      yearly,
    };
    for (const bucket of Object.keys(buckets) as Array<keyof typeof buckets>) {
      for (const item of buckets[bucket].slice(limits[bucket])) {
        if (await this.deleteBackupRecord(item.id)) deleted += 1;
      }
    }

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
        if (await this.deleteBackupRecord(item.id)) deleted += 1;
      }
    }

    const safetyBackups = await this.prisma.backupJob.findMany({
      where: { status: 'completed', locked: false, type: 'safety' },
      orderBy: { completedAt: 'desc' },
    });
    for (const item of safetyBackups.slice(safetyLimit)) {
      if (await this.deleteBackupRecord(item.id)) deleted += 1;
    }
    return deleted;
  }

  private async deleteBackupRecord(
    id: string,
    manual = false,
  ): Promise<boolean> {
    const reservation = await this.withLifecycleLock(async (tx) => {
      const job = await tx.backupJob.findUnique({ where: { id } });
      if (!job) return null;
      if (job.locked) {
        if (manual) {
          throw new ConflictException('Unlock this backup before deleting it');
        }
        return null;
      }
      if (['pending', 'running', 'restoring'].includes(job.status)) {
        if (manual) {
          throw new ConflictException(
            'An active backup or restore cannot be deleted',
          );
        }
        return null;
      }

      const previousStatus =
        job.status === 'deleting'
          ? job.fileKey
            ? 'completed'
            : 'failed'
          : job.status;
      if (job.status !== 'deleting') {
        await tx.backupJob.update({
          where: { id },
          data: { status: 'deleting', errorMessage: null },
        });
      }
      return { job, previousStatus };
    });
    if (!reservation) return false;

    try {
      if (reservation.job.fileKey) {
        await this.storage.deleteBackup(reservation.job.fileKey);
      }
      await this.withLifecycleLock(async (tx) => {
        await tx.backupJob.deleteMany({
          where: { id, status: 'deleting' },
        });
      });
      return true;
    } catch (error) {
      await this.prisma.backupJob
        .updateMany({
          where: { id, status: 'deleting' },
          data: {
            status: reservation.previousStatus,
            errorMessage: `Backup deletion failed: ${safeErrorMessage(error)}`,
          },
        })
        .catch(() => {});
      throw error;
    }
  }

  async listBackups(query: BackupListQuery) {
    const page = Math.max(1, positiveInteger(String(query.page || ''), 1));
    const limit = Math.min(100, positiveInteger(String(query.limit || ''), 20));
    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.scope) where.scope = query.scope;
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { fileKey: { contains: search, mode: 'insensitive' } },
        { errorMessage: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.backupJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.backupJob.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getBackup(id: string) {
    const job = await this.prisma.backupJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Backup not found');
    return job;
  }

  private parseDownloadRange(
    header: string | undefined,
    total: bigint | null,
  ): DownloadByteRange | undefined {
    if (!header) return undefined;
    if (
      total === null ||
      total <= 0n ||
      total > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new HttpException(
        'Requested range is not satisfiable',
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2])) {
      throw new HttpException(
        'Only a single byte range is supported',
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }

    let start: bigint;
    let end: bigint;
    if (!match[1]) {
      const suffix = BigInt(match[2]);
      if (suffix <= 0n) {
        throw new HttpException(
          'Requested range is not satisfiable',
          HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        );
      }
      start = suffix >= total ? 0n : total - suffix;
      end = total - 1n;
    } else {
      start = BigInt(match[1]);
      end = match[2] ? BigInt(match[2]) : total - 1n;
      if (end >= total) end = total - 1n;
    }
    if (start >= total || end < start) {
      throw new HttpException(
        'Requested range is not satisfiable',
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }
    return { start: Number(start), end: Number(end), total };
  }

  async downloadBackup(
    id: string,
    rangeHeader?: string,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    filename: string;
    mimeType: string;
    size: bigint | null;
    range?: DownloadByteRange;
  }> {
    const job = await this.getBackup(id);
    if (!job.fileKey) {
      throw new BadRequestException('Backup file not available');
    }
    if (job.status !== 'completed') {
      throw new BadRequestException('Backup not completed');
    }
    const range = this.parseDownloadRange(rangeHeader, job.fileSize);
    return {
      stream: await this.storage.readBackupStream(job.fileKey, range),
      filename:
        basename(job.fileKey) ||
        `backup-${id}.${job.scope === 'db_files' ? 'tar.gz' : 'sql.gz'}`,
      mimeType: 'application/gzip',
      size: range ? BigInt(range.end - range.start + 1) : job.fileSize,
      range,
    };
  }

  private downloadSigningSecret(): string {
    const secret =
      process.env.BACKUP_DOWNLOAD_SECRET || process.env.JWT_SECRET || '';
    if (!secret) {
      throw new InternalServerErrorException(
        'Backup download signing secret is not configured',
      );
    }
    return secret;
  }

  async createDownloadTicket(
    id: string,
  ): Promise<{ token: string; expiresAt: string }> {
    await this.downloadBackupMetadata(id);
    const expiresAt =
      Date.now() +
      positiveInteger(
        process.env.BACKUP_DOWNLOAD_TTL_MS,
        DEFAULT_BACKUP_DOWNLOAD_TTL_MS,
      );
    const payload = Buffer.from(
      JSON.stringify({ id, exp: expiresAt, nonce: randomUUID() }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.downloadSigningSecret())
      .update(payload)
      .digest('base64url');
    return {
      token: `${payload}.${signature}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  private async downloadBackupMetadata(id: string) {
    const job = await this.getBackup(id);
    if (job.status !== 'completed' || !job.fileKey) {
      throw new BadRequestException('Backup file is not available');
    }
    return job;
  }

  private verifyDownloadTicket(id: string, token: string): void {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) {
      throw new BadRequestException('Invalid download ticket');
    }
    const expectedSignature = createHmac('sha256', this.downloadSigningSecret())
      .update(payload)
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedSignature, 'base64url');
    } catch {
      throw new BadRequestException('Invalid download ticket');
    }
    if (
      supplied.length !== expectedSignature.length ||
      !timingSafeEqual(supplied, expectedSignature)
    ) {
      throw new BadRequestException('Invalid download ticket');
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { id?: string; exp?: number };
      if (
        decoded.id !== id ||
        !Number.isFinite(decoded.exp) ||
        decoded.exp! < Date.now()
      ) {
        throw new Error('expired');
      }
    } catch {
      throw new BadRequestException('Expired or invalid download ticket');
    }
  }

  async downloadBackupWithTicket(
    id: string,
    token: string,
    rangeHeader?: string,
  ) {
    this.verifyDownloadTicket(id, token);
    return this.downloadBackup(id, rangeHeader);
  }

  async restoreFromBackup(id: string): Promise<{ id: string }> {
    const source = await this.downloadBackupMetadata(id);
    await this.withLifecycleLock(async (tx) => {
      await this.ensureRestoreCanStart(tx);
      const claimed = await tx.backupJob.updateMany({
        where: {
          id,
          status: 'completed',
          fileKey: source.fileKey,
        },
        data: {
          status: 'restoring',
          startedAt: new Date(),
          errorMessage: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'Backup changed or was reserved for deletion before restore could start',
        );
      }
    });

    try {
      await this.enqueueRestore({
        operation: 'restore',
        backupId: id,
        sourceSnapshot: this.serializeBackupSnapshot(source),
        preserveSourceOnFailure: true,
      });
    } catch (error) {
      await this.handleRestoreFailure(source, error, true);
      throw error;
    }
    return { id };
  }

  private async ensureRestoreCanStart(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const [durableRestore, activeRestore, activeBackup] = await Promise.all([
      this.getActiveRestoreControl(client),
      client.backupJob.findFirst({
        where: { status: 'restoring' },
        select: { id: true },
      }),
      client.backupJob.findFirst({
        where: { status: { in: ['pending', 'running'] } },
        select: { id: true },
      }),
    ]);
    if (durableRestore) {
      throw new ConflictException(
        `Restore ${durableRestore.operationId} is still in ${durableRestore.phase} recovery`,
      );
    }
    if (activeRestore) {
      throw new ConflictException('Another restore is in progress');
    }
    if (activeBackup) {
      throw new ConflictException(
        'Wait for the pending or running backup to finish before restoring',
      );
    }
  }

  private normalizeUploadedFilename(filename: string): string {
    const safe = basename(filename);
    const lower = safe.toLowerCase();
    if (
      !safe ||
      safe !== filename ||
      (!lower.endsWith('.sql.gz') && !lower.endsWith('.tar.gz'))
    ) {
      throw new BadRequestException(
        'Backup filename must end with .sql.gz or .tar.gz',
      );
    }
    return safe;
  }

  private async removeIncomingUploadDir(path: string): Promise<void> {
    const parent = dirname(path);
    const workRoot = await this.backupWorkRoot();
    if (
      dirname(parent) === workRoot &&
      basename(parent).startsWith('backup-upload-')
    ) {
      await rm(parent, { recursive: true, force: true }).catch(() => {});
    }
  }

  async restoreFromUpload(
    tmpPath: string,
    filename: string,
  ): Promise<{ id: string }> {
    const safeFilename = this.normalizeUploadedFilename(filename);
    const uploadTmpDir = join(
      await this.backupWorkRoot(),
      `ecomate-restore-upload-${randomUUID()}`,
    );
    await mkdir(uploadTmpDir, { recursive: true });
    const managedPath = join(uploadTmpDir, safeFilename);

    try {
      await rename(tmpPath, managedPath);
      await this.removeIncomingUploadDir(tmpPath);
      await this.assertGzipFile(managedPath);
      if (safeFilename.toLowerCase().endsWith('.tar.gz')) {
        await this.validateArchive(managedPath);
      }
      const [fileStat, checksum] = await Promise.all([
        stat(managedPath),
        this.hashFile(managedPath),
      ]);
      const job = await this.withLifecycleLock(async (tx) => {
        await this.ensureRestoreCanStart(tx);
        return tx.backupJob.create({
          data: {
            type: 'uploaded',
            scope: safeFilename.toLowerCase().endsWith('.tar.gz')
              ? 'db_files'
              : 'db_only',
            status: 'restoring',
            fileSize: BigInt(fileStat.size),
            checksum,
            startedAt: new Date(),
          },
        });
      });

      try {
        await this.enqueueRestore({
          operation: 'restore',
          backupId: job.id,
          tmpPath: managedPath,
          uploadTmpDir,
          sourceSnapshot: this.serializeBackupSnapshot(job),
          preserveSourceOnFailure: false,
        });
      } catch (error) {
        await this.handleRestoreFailure(job, error, false);
        throw error;
      }
      return { id: job.id };
    } catch (error) {
      await rm(uploadTmpDir, { recursive: true, force: true }).catch(() => {});
      await this.removeIncomingUploadDir(tmpPath);
      throw error;
    }
  }

  async uploadOnly(tmpPath: string, filename: string): Promise<{ id: string }> {
    const safeFilename = this.normalizeUploadedFilename(filename);
    const uploadTmpDir = join(
      await this.backupWorkRoot(),
      `ecomate-backup-upload-${randomUUID()}`,
    );
    await mkdir(uploadTmpDir, { recursive: true });
    const managedPath = join(uploadTmpDir, safeFilename);
    let job: any = null;
    let stopHeartbeat: (() => Promise<void>) | null = null;

    try {
      await rename(tmpPath, managedPath);
      await this.removeIncomingUploadDir(tmpPath);
      await this.assertGzipFile(managedPath);
      if (safeFilename.toLowerCase().endsWith('.tar.gz')) {
        await this.validateArchive(managedPath);
      }

      const [fileStat, checksum] = await Promise.all([
        stat(managedPath),
        this.hashFile(managedPath),
      ]);
      job = await this.withLifecycleLock(async (tx) => {
        await this.ensureRestoreCanStart(tx);
        return tx.backupJob.create({
          data: {
            type: 'uploaded',
            scope: safeFilename.toLowerCase().endsWith('.tar.gz')
              ? 'db_files'
              : 'db_only',
            status: 'running',
            fileSize: BigInt(fileStat.size),
            checksum,
            startedAt: new Date(),
          },
        });
      });
      stopHeartbeat = this.startLifecycleHeartbeat(job.id, ['running']);

      const storageKey = this.storage.createBackupKey(job.id, safeFilename);
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: { fileKey: storageKey },
      });
      await this.storage.storeBackupStream(
        storageKey,
        createReadStream(managedPath),
        'application/gzip',
      );
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          fileKey: storageKey,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      return { id: job.id };
    } catch (error) {
      if (job) {
        await this.prisma.backupJob
          .update({
            where: { id: job.id },
            data: {
              status: 'failed',
              errorMessage: safeErrorMessage(error),
            },
          })
          .catch(() => {});
      }
      throw error;
    } finally {
      await stopHeartbeat?.();
      await rm(uploadTmpDir, { recursive: true, force: true }).catch(() => {});
      await this.removeIncomingUploadDir(tmpPath);
    }
  }

  private sizeLimitTransform(limit: bigint): Transform {
    let total = 0n;
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += BigInt(chunk.length);
        if (total > limit) {
          callback(
            new Error(
              `Decompressed database exceeds ${limit.toString()} bytes`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });
  }

  private async assertUploadedSqlIsSafe(sqlPath: string): Promise<void> {
    let inCopyData = false;
    let restrictToken: string | null = null;
    let statementBytes = 0;
    let statementParts: string[] = [];
    let blockCommentDepth = 0;
    let singleQuoted = false;
    let singleBackslashEscapes = false;
    let doubleQuoted = false;
    let dollarQuote: string | null = null;

    const sanitizeLine = (line: string): string => {
      let sanitized = '';
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1] || '';

        if (blockCommentDepth > 0) {
          if (char === '/' && next === '*') {
            blockCommentDepth += 1;
            sanitized += '  ';
            index += 1;
          } else if (char === '*' && next === '/') {
            blockCommentDepth -= 1;
            sanitized += '  ';
            index += 1;
          } else {
            sanitized += ' ';
          }
          continue;
        }

        if (dollarQuote) {
          if (line.startsWith(dollarQuote, index)) {
            sanitized += ' '.repeat(dollarQuote.length);
            index += dollarQuote.length - 1;
            dollarQuote = null;
          } else {
            sanitized += ' ';
          }
          continue;
        }

        if (singleQuoted) {
          sanitized += ' ';
          if (char === "'" && next === "'") {
            sanitized += ' ';
            index += 1;
          } else if (singleBackslashEscapes && char === '\\' && next) {
            sanitized += ' ';
            index += 1;
          } else if (char === "'") {
            singleQuoted = false;
            singleBackslashEscapes = false;
          }
          continue;
        }

        if (doubleQuoted) {
          sanitized += ' ';
          if (char === '"' && next === '"') {
            sanitized += ' ';
            index += 1;
          } else if (char === '"') {
            doubleQuoted = false;
          }
          continue;
        }

        if (char === '-' && next === '-') {
          sanitized += ' '.repeat(line.length - index);
          break;
        }
        if (char === '/' && next === '*') {
          blockCommentDepth = 1;
          sanitized += '  ';
          index += 1;
          continue;
        }
        if (char === "'") {
          singleQuoted = true;
          const previous = line[index - 1] || '';
          const beforePrevious = line[index - 2] || '';
          singleBackslashEscapes =
            (previous === 'E' || previous === 'e') &&
            !/[A-Za-z0-9_$]/.test(beforePrevious);
          sanitized += ' ';
          continue;
        }
        if (char === '"') {
          doubleQuoted = true;
          sanitized += ' ';
          continue;
        }
        if (char === '$') {
          const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
            line.slice(index),
          );
          if (match) {
            dollarQuote = match[0];
            sanitized += ' '.repeat(match[0].length);
            index += match[0].length - 1;
            continue;
          }
        }
        sanitized += char;
      }
      return sanitized;
    };

    const inspectStatement = () => {
      const statement = statementParts.join('\n');
      if (
        /\b(?:pg_catalog\s*\.\s*)?(?:pg_read_file|pg_read_binary_file|pg_write_file|pg_ls_dir|lo_import|lo_export)\s*\(/i.test(
          statement,
        )
      ) {
        throw new Error(
          'Uploaded backup contains a prohibited server-file SQL function',
        );
      }
      if (/\bLANGUAGE\s+(?:c|plperlu|plpythonu)\b/i.test(statement)) {
        throw new Error(
          'Uploaded backup contains a prohibited untrusted function language',
        );
      }
      if (/\bSECURITY\s+DEFINER\b/i.test(statement)) {
        throw new Error(
          'Uploaded backup contains a prohibited SECURITY DEFINER routine',
        );
      }
      if (
        /(?:^|;)\s*(?:BEGIN\b|START\s+TRANSACTION\b|COMMIT\b|ROLLBACK\b|ABORT\b|SAVEPOINT\b|RELEASE\s+(?:SAVEPOINT\s+)?\S+|PREPARE\s+TRANSACTION\b|SET\s+(?:LOCAL\s+|SESSION\s+)?TRANSACTION\b|SET\s+SESSION\s+CHARACTERISTICS\s+AS\s+TRANSACTION\b)/im.test(
          statement,
        ) ||
        /(?:^|;)\s*END(?:\s+(?:WORK|TRANSACTION))?\s*(?:;|$)/im.test(
          statement,
        )
      ) {
        throw new Error(
          'Uploaded backup contains prohibited transaction control that could escape the atomic restore',
        );
      }
      if (
        /(?:^|;)\s*(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|GROUP|EXTENSION|SCHEMA)\b/im.test(
          statement,
        )
      ) {
        throw new Error(
          'Uploaded backup contains prohibited cluster or schema administration',
        );
      }
      if (
        /\b(?:SET|RESET)\s+(?:SESSION\s+)?AUTHORIZATION\b/i.test(statement) ||
        /\b(?:SET|RESET)\s+(?:(?:LOCAL|SESSION)\s+)?ROLE\b/i.test(statement) ||
        /\bSET\s+standard_conforming_strings\s*(?:=|TO)\s*off\b/i.test(
          statement,
        )
      ) {
        throw new Error(
          'Uploaded backup contains a prohibited role-switching statement',
        );
      }
      statementParts = [];
      statementBytes = 0;
    };

    const processLine = (lineBuffer: Buffer, oversized: boolean) => {
      let rawLine = lineBuffer.toString('utf8');
      if (rawLine.endsWith('\r')) rawLine = rawLine.slice(0, -1);
      if (rawLine.includes('\0')) {
        throw new Error('Uploaded backup contains a NUL byte');
      }

      if (inCopyData) {
        // COPY rows can legitimately be multi-gigabyte. Only the exact raw
        // terminator has control meaning; all other bytes remain data.
        if (!oversized && rawLine === '\\.') inCopyData = false;
        return;
      }
      if (oversized) {
        throw new Error(
          `Uploaded SQL contains a line larger than ${MAX_UPLOADED_SQL_LINE_BYTES} bytes`,
        );
      }

      const rawTrimmed = rawLine.trim();
      if (
        rawTrimmed.startsWith('\\') &&
        /^\\(?:un)?restrict(?:\s|$)/i.test(rawTrimmed)
      ) {
        if (statementBytes > 0 || blockCommentDepth > 0) {
          throw new Error('psql restriction command appears inside SQL');
        }
        const restrictMatch = /^\\restrict\s+(\S+)$/i.exec(rawTrimmed);
        if (restrictMatch) {
          if (restrictToken) {
            throw new Error('Uploaded backup contains nested \\restrict');
          }
          restrictToken = restrictMatch[1];
          return;
        }
        const unrestrictMatch = /^\\unrestrict\s+(\S+)$/i.exec(rawTrimmed);
        if (!unrestrictMatch || unrestrictMatch[1] !== restrictToken) {
          throw new Error(
            'Uploaded backup contains a mismatched \\unrestrict token',
          );
        }
        restrictToken = null;
        return;
      }

      const sanitized = sanitizeLine(rawLine);
      const code = sanitized.trim();
      if (!code) return;
      if (sanitized.includes('\\')) {
        throw new Error(
          'Uploaded backup contains a prohibited psql backslash command',
        );
      }

      const lineBytes = Buffer.byteLength(rawLine);
      const copyFromStdin =
        statementBytes === 0 &&
        /^COPY\s+[^;]+\s+FROM\s+stdin\s*;\s*$/i.test(code);
      if (copyFromStdin) {
        inCopyData = true;
        return;
      }
      if (/\bCOPY\b/i.test(code)) {
        throw new Error(
          'Uploaded backup contains COPY other than the supported pg_dump FROM stdin form',
        );
      }

      statementBytes += lineBytes;
      if (statementBytes > MAX_UPLOADED_SQL_STATEMENT_BYTES) {
        throw new Error(
          `Uploaded SQL statement exceeds ${MAX_UPLOADED_SQL_STATEMENT_BYTES} bytes`,
        );
      }
      statementParts.push(sanitized);
      if (code.endsWith(';')) inspectStatement();
    };

    let lineChunks: Buffer[] = [];
    let lineBytes = 0;
    let oversized = false;
    for await (const rawChunk of createReadStream(sqlPath, {
      highWaterMark: 64 * 1024,
    })) {
      const chunk = rawChunk as Buffer;
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(0x0a, offset);
        const end = newline === -1 ? chunk.length : newline;
        const segment = chunk.subarray(offset, end);
        lineBytes += segment.length;
        if (!oversized) {
          const remaining =
            MAX_UPLOADED_SQL_LINE_BYTES +
            1 -
            lineChunks.reduce((total, part) => total + part.length, 0);
          if (remaining > 0) {
            lineChunks.push(Buffer.from(segment.subarray(0, remaining)));
          }
          if (lineBytes > MAX_UPLOADED_SQL_LINE_BYTES) oversized = true;
        }
        if (oversized && !inCopyData) {
          throw new Error(
            `Uploaded SQL contains a line larger than ${MAX_UPLOADED_SQL_LINE_BYTES} bytes`,
          );
        }
        if (newline === -1) break;

        processLine(Buffer.concat(lineChunks), oversized);
        lineChunks = [];
        lineBytes = 0;
        oversized = false;
        offset = newline + 1;
      }
    }
    if (lineBytes > 0 || lineChunks.length > 0) {
      processLine(Buffer.concat(lineChunks), oversized);
    }
    if (inCopyData) {
      throw new Error('Uploaded backup has an unterminated COPY data section');
    }
    if (
      blockCommentDepth > 0 ||
      singleQuoted ||
      singleBackslashEscapes ||
      doubleQuoted ||
      dollarQuote
    ) {
      throw new Error('Uploaded backup contains unterminated SQL quoting');
    }
    if (statementBytes > 0) inspectStatement();
    if (restrictToken) {
      throw new Error('Uploaded backup has an unterminated \\restrict block');
    }
  }

  private async createSafetyBackup(): Promise<any | null> {
    const enabled = await this.getSetting('backup_restore_auto_backup', 'true');
    if (enabled !== 'true') return null;

    const safety = await this.createBackupJob('db_files', 'safety');
    await this.runBackupPipeline(safety.id, { allowDuringRestore: true });
    return this.prisma.backupJob.findUnique({ where: { id: safety.id } });
  }

  private async runRestorePipeline(
    backupId: string,
    options: RestoreOptions,
  ): Promise<void> {
    const workDir = join(
      await this.backupWorkRoot(),
      `ecomate-restore-${backupId}`,
    );

    let sourcePath = options.tmpPath;
    let safetySnapshot: any | null = null;
    let catalogSnapshots: any[] = [];
    let mediaPaused = false;
    let backgroundQueuesPaused = false;
    let maintenanceLease: MaintenanceLease | null = null;
    let restoreControlRegistered = false;
    let databaseCommitted = false;
    let postRestoreReady = false;
    const sourceSnapshot =
      options.sourceSnapshot ||
      (await this.prisma.backupJob.findUnique({ where: { id: backupId } }));
    if (!sourceSnapshot) throw new Error('Restore source record not found');

    try {
      await this.setRestoreControlPhase(backupId, 'preparing');
      restoreControlRegistered = true;
      // Publish the durable write fence before draining HTTP/queue work. This
      // stops timer and GET-triggered background writers on every replica while
      // the shared maintenance lease waits for already-running requests.
      maintenanceLease = await this.enterMaintenance('restore');
      mediaPaused = true;
      await this.mediaQueue.pauseAndDrain();
      backgroundQueuesPaused = true;
      await this.pauseMaintenanceQueuesAndDrain();
      await rm(workDir, { recursive: true, force: true });
      await mkdir(workDir, { recursive: true });
      // A safety backup must finish successfully before the destructive SQL
      // transaction starts. The former implementation merely enqueued it and
      // immediately began restoring, making the "safety" copy race the restore.
      safetySnapshot = await this.createSafetyBackup();
      // Restoring an older SQL dump also restores its old BackupJob table.
      // Preserve every still-downloadable current backup so newer objects do
      // not become invisible/orphaned after a successful historical restore.
      catalogSnapshots = await this.prisma.backupJob.findMany({
        where: { status: 'completed', fileKey: { not: null } },
      });
      await this.setRestoreControlSnapshots(
        backupId,
        this.serializeBackupSnapshot(sourceSnapshot),
        catalogSnapshots.map((snapshot) =>
          this.serializeBackupSnapshot(snapshot),
        ),
      );

      if (!sourcePath) {
        if (!sourceSnapshot.fileKey) throw new Error('No backup file');
        if (sourceSnapshot.fileSize) {
          await this.assertWorkingSpace(
            workDir,
            BigInt(sourceSnapshot.fileSize),
            'Backup download',
          );
        }
        sourcePath = join(workDir, basename(sourceSnapshot.fileKey));
        await pipeline(
          await this.storage.readBackupStream(sourceSnapshot.fileKey),
          createWriteStream(sourcePath, { flags: 'wx' }),
        );
      }

      await this.assertGzipFile(sourcePath);
      const actualChecksum = await this.hashFile(sourcePath);
      if (
        sourceSnapshot.checksum &&
        actualChecksum !== sourceSnapshot.checksum
      ) {
        throw new Error(
          `Backup checksum mismatch: expected ${sourceSnapshot.checksum}, received ${actualChecksum}`,
        );
      }

      let sqlDumpPath: string;
      let archiveValidation: ArchiveValidation | null = null;
      let extractRoot: string | null = null;
      let backupManifest: BackupManifest | null = null;

      if (sourcePath.toLowerCase().endsWith('.tar.gz')) {
        archiveValidation = await this.validateArchive(sourcePath);
        if (
          !archiveValidation.hasManifest &&
          archiveValidation.layout === 'none' &&
          process.env.BACKUP_ALLOW_EMPTY_LEGACY_TAR !== 'true'
        ) {
          throw new Error(
            'Legacy full backup contains only dump.sql and no media. Restore it only as an explicitly approved database-only legacy backup, or regenerate a complete full backup',
          );
        }
        await this.assertWorkingSpace(
          workDir,
          archiveValidation.expandedBytes,
          'Backup extraction',
        );
        extractRoot = join(workDir, 'extracted');
        await extractValidatedTarBackup(
          sourcePath,
          extractRoot,
          this.maxDecompressionRatio,
        );
        if (archiveValidation.hasManifest) {
          backupManifest = await readBackupManifest(extractRoot);
          if (
            backupManifest?.localFilesIncluded &&
            archiveValidation.contentBytes === 0n
          ) {
            throw new Error(
              'Backup manifest says local content is included, but the archive contains no content files',
            );
          }
        }
        sqlDumpPath = join(extractRoot, BACKUP_SQL_FILENAME);
      } else {
        sqlDumpPath = join(workDir, 'restore.sql');
        await pipeline(
          createReadStream(sourcePath),
          createGunzip(),
          this.sizeLimitTransform(this.maxRestoreBytes),
          createWriteStream(sqlDumpPath, { flags: 'wx' }),
        );
      }

      const sqlStat = await stat(sqlDumpPath);
      if (sqlStat.size === 0) throw new Error('Backup SQL dump is empty');
      if (sourceSnapshot.type === 'uploaded') {
        await this.assertUploadedSqlIsSafe(sqlDumpPath);
      }

      let preparedContent: Awaited<
        ReturnType<typeof prepareBackupContentRestore>
      > | null = null;
      if (archiveValidation && extractRoot) {
        const uploadRoot = join(process.cwd(), 'uploads');
        await this.assertWorkingSpace(
          uploadRoot,
          archiveValidation.contentBytes,
          'Content restore staging',
        );
        preparedContent = await prepareBackupContentRestore(
          extractRoot,
          uploadRoot,
          archiveValidation.layout,
          backupId,
          backupManifest?.includePaths,
        );
        await preparedContent.apply();
      }

      try {
        await this.restoreDatabase(
          sqlDumpPath,
          backupId,
          sourceSnapshot.type === 'uploaded',
        );
        databaseCommitted = true;
      } catch (error) {
        if (preparedContent) {
          try {
            await preparedContent.rollback();
            await preparedContent.commit();
          } catch (rollbackError) {
            this.logger.error(
              `Database restore failed and content rollback also failed: ${safeErrorMessage(rollbackError)}`,
            );
          }
        }
        throw error;
      }

      // The control-plane row is updated to database_committed by the same
      // psql transaction as the historical dump. It remains authoritative if
      // this process dies before the filesystem journal can be updated.
      if (preparedContent) {
        await preparedContent.markDatabaseCommitted().catch((error) => {
          this.logger.error(
            `Could not persist restore DB-commit marker: ${safeErrorMessage(error)}`,
          );
        });
      }

      // Historical dumps can predate the currently running application. Bring
      // the restored public schema forward before any Prisma model query or
      // queue is allowed to observe it.
      await this.applyCurrentMigrations();

      if (preparedContent) {
        await preparedContent.commit();
        this.logger.log(
          `Restored ${preparedContent.files} content files, removed ${preparedContent.removedFiles} post-snapshot files (${preparedContent.bytes.toString()} bytes)`,
        );
      }

      // Path-based resize caches can contain a tiny/old derivative for the same
      // URL. They must be discarded after file promotion.
      await rm(join(process.cwd(), '.cache', 'images'), {
        recursive: true,
        force: true,
      }).catch(() => {});

      const preservedBackupIds = new Set<string>([
        sourceSnapshot.id,
        ...catalogSnapshots.map((snapshot) => snapshot.id),
      ]);
      if (safetySnapshot) preservedBackupIds.add(safetySnapshot.id);
      // The archive deliberately excludes backup artifacts themselves.
      // Completed rows that exist only inside the historical dump would be
      // ghost download links on a new installation.
      await this.prisma.backupJob.deleteMany({
        where: {
          status: 'completed',
          fileKey: { not: null },
          id: { notIn: [...preservedBackupIds] },
        },
      });

      for (const snapshot of catalogSnapshots) {
        await this.persistBackupSnapshot(snapshot, {
          status: 'completed',
          errorMessage: snapshot.errorMessage ?? null,
        });
      }
      const requiredSnapshots = new Map<string, any>([
        [sourceSnapshot.id, sourceSnapshot],
      ]);
      if (safetySnapshot) {
        requiredSnapshots.set(safetySnapshot.id, safetySnapshot);
      }
      for (const snapshot of requiredSnapshots.values()) {
        await this.persistBackupSnapshot(snapshot, {
          status: snapshot.id === sourceSnapshot.id ? 'restoring' : 'completed',
          errorMessage: null,
        });
      }

      await this.repairLocalMediaAfterRestore();
      await this.invalidatePostRestoreCaches();
      await this.reregisterRepeatableJob().catch((error) => {
        this.logger.error(
          `Restored settings contain an invalid backup schedule: ${safeErrorMessage(error)}`,
        );
      });
      await this.enqueueLegacyBackupMigrations();
      await this.cleanupRestoreExecutionRoleForOperation(backupId);
      await this.clearRestoreControlOperation(backupId);
      restoreControlRegistered = false;
      postRestoreReady = true;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (options.uploadTmpDir) {
        await rm(options.uploadTmpDir, {
          recursive: true,
          force: true,
        }).catch(() => {});
      }

      let canReleaseMaintenance = !databaseCommitted || postRestoreReady;
      if (restoreControlRegistered && !databaseCommitted) {
        try {
          await this.cleanupRestoreExecutionRoleForOperation(backupId);
          await this.clearRestoreControlOperation(backupId);
          restoreControlRegistered = false;
        } catch (error) {
          canReleaseMaintenance = false;
          this.logger.error(
            `Could not clear pre-commit restore control state: ${safeErrorMessage(error)}`,
          );
        }
      } else if (restoreControlRegistered && databaseCommitted) {
        await this.setRestoreControlPhase(
          backupId,
          'failed_after_commit',
        ).catch((error) => {
          this.logger.error(
            `Could not mark post-commit restore failure: ${safeErrorMessage(error)}`,
          );
        });
      }

      if (mediaPaused && canReleaseMaintenance) {
        await this.mediaQueue.resume().catch((error) => {
          this.logger.error(
            `Could not resume media processing: ${safeErrorMessage(error)}`,
          );
        });
      }
      if (backgroundQueuesPaused && canReleaseMaintenance) {
        await this.resumeMaintenanceQueues().catch((error) => {
          this.logger.error(
            `Could not resume background queues after restore: ${safeErrorMessage(error)}`,
          );
        });
      }
      if (canReleaseMaintenance && maintenanceLease) {
        await this.leaveMaintenance(maintenanceLease).catch((error) => {
          this.logger.error(
            `Could not clear restore maintenance flag: ${safeErrorMessage(error)}`,
          );
        });
      } else {
        this.logger.error(
          'Restore committed but post-restore verification did not finish; maintenance remains active for crash recovery',
        );
      }
    }

    // Keep the source marked `restoring` until maintenance and the globally
    // paused media queue are both released. This closes the window where a
    // second lifecycle operation could start and tear down the first one's
    // maintenance barrier.
    await this.persistBackupSnapshot(sourceSnapshot, {
      status: 'completed',
      errorMessage: null,
    });
    try {
      await this.performCleanup();
    } catch (error) {
      this.logger.warn(
        `Restore completed, but backup retention cleanup failed: ${safeErrorMessage(error)}`,
      );
    }
  }

  private async restoreDatabase(
    sqlDumpPath: string,
    operationId: string,
    uploaded: boolean,
  ): Promise<void> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL is not configured');
    const parsed = parseDbUrl(dbUrl);
    const terminationUrl = process.env.BACKUP_RESTORE_DATABASE_URL || dbUrl;
    const terminationTarget = parseDbUrl(terminationUrl);
    if (
      terminationTarget.database !== parsed.database ||
      terminationTarget.host !== parsed.host ||
      terminationTarget.port !== parsed.port
    ) {
      throw new Error(
        'BACKUP_RESTORE_DATABASE_URL must target the same host, port, and database as DATABASE_URL',
      );
    }
    const escapedDatabase = parsed.database.replace(/'/g, "''");

    try {
      const { stdout } = await execFileAsync(
        'psql',
        [
          '--no-psqlrc',
          '--quiet',
          '--tuples-only',
          '--no-align',
          '--host',
          terminationTarget.host,
          '--port',
          terminationTarget.port,
          '--username',
          terminationTarget.user,
          '--dbname',
          terminationTarget.database,
          '--command',
          `SELECT COALESCE(bool_and(pg_terminate_backend(pid)), true) FROM pg_stat_activity WHERE datname='${escapedDatabase}' AND pid <> pg_backend_pid() AND application_name NOT LIKE 'ecomate-backup-%'`,
        ],
        {
          env: postgresEnv(terminationTarget),
          timeout: 30_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      if (stdout.trim() !== 't') {
        throw new Error('PostgreSQL refused to terminate one or more sessions');
      }
    } catch (error) {
      throw new Error(
        `Could not establish an exclusive database restore window: ${safeErrorMessage(error)}`,
      );
    }

    const execution = uploaded
      ? await this.prepareUploadedRestoreExecution(
          terminationUrl,
          dbUrl,
          operationId,
        )
      : { parsed, cleanup: async () => {} };

    const resetPublicSchema =
      'DROP SCHEMA IF EXISTS public CASCADE; ' +
      'CREATE SCHEMA public AUTHORIZATION CURRENT_USER;';
    const markDatabaseCommitted =
      `DO $ecomate_restore$ BEGIN ` +
      `UPDATE ${quotePgIdentifier(RESTORE_CONTROL_SCHEMA)}.${quotePgIdentifier(RESTORE_CONTROL_TABLE)} ` +
      `SET "phase" = 'database_committed', "updated_at" = clock_timestamp() ` +
      `WHERE "operation_id" = ${quotePgLiteral(operationId)}; ` +
      `IF NOT FOUND THEN RAISE EXCEPTION 'Restore control row is missing'; END IF; ` +
      `END $ecomate_restore$;`;

    try {
      const { stderr } = await execFileAsync(
        'psql',
        [
          '--no-psqlrc',
          '--quiet',
          '--set=ON_ERROR_STOP=1',
          '--single-transaction',
          '--host',
          execution.parsed.host,
          '--port',
          execution.parsed.port,
          '--username',
          execution.parsed.user,
          '--dbname',
          execution.parsed.database,
          '--command',
          resetPublicSchema,
          '--file',
          sqlDumpPath,
          '--command',
          markDatabaseCommitted,
        ],
        {
          env: postgresEnv(execution.parsed),
          timeout: this.restoreTimeout,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      if (stderr && !stderr.includes('deprecated')) {
        this.logger.warn(`psql restore warning: ${stderr.slice(0, 4000)}`);
      }
    } finally {
      await execution.cleanup().catch((error) => {
        // The durable control row retains the generated role name. Reconcile
        // can retry ownership reassignment without ever rolling committed
        // media backward.
        this.logger.error(
          `Could not clean uploaded-restore sandbox role: ${safeErrorMessage(error)}`,
        );
      });
    }
  }

  private pgClient(parsed: ParsedDbUrl, applicationName: string): Client {
    return new Client({
      host: parsed.host,
      port: Number(parsed.port),
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      application_name: applicationName,
      ...(parsed.sslMode && parsed.sslMode !== 'disable'
        ? { ssl: { rejectUnauthorized: parsed.sslMode === 'verify-full' } }
        : {}),
    });
  }

  private restoreExecutionRoleName(operationId: string): string {
    return `ecomate_restore_${createHash('sha256')
      .update(operationId)
      .digest('hex')
      .slice(0, 32)}`;
  }

  private async prepareUploadedRestoreExecution(
    controlUrl: string,
    dbUrl: string,
    operationId: string,
  ): Promise<{ parsed: ParsedDbUrl; cleanup: () => Promise<void> }> {
    const parsed = parseDbUrl(dbUrl);
    const controlTarget = parseDbUrl(controlUrl);
    const control = this.pgClient(
      controlTarget,
      'ecomate-restore-role-setup',
    );
    await control.connect();
    try {
      const privilege = await control.query<{ rolsuper: boolean }>(`
        SELECT "rolsuper"
        FROM pg_roles
        WHERE rolname = current_user
      `);
      const role = privilege.rows[0];
      if (!role) throw new Error('Could not inspect database restore role');
      if (!role.rolsuper) {
        throw new BadRequestException(
          'Uploaded backups require BACKUP_RESTORE_DATABASE_URL to use a PostgreSQL superuser so the SQL can run inside a disposable least-privilege sandbox',
        );
      }

      // Never execute uploaded SQL as either the application owner or the
      // privileged control connection. The deterministic name lets crash
      // recovery find the role even if the worker dies between CREATE ROLE
      // and recording it in the durable control row.
      const sandboxRole = this.restoreExecutionRoleName(operationId);
      const sandboxPassword = `${randomUUID()}${randomUUID()}`;
      const quotedSandbox = quotePgIdentifier(sandboxRole);
      const quotedOwner = quotePgIdentifier(parsed.user);
      const quotedDatabase = quotePgIdentifier(parsed.database);
      const existingRole = await control.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "exists"',
        [sandboxRole],
      );
      if (existingRole.rows[0]?.exists) {
        throw new ConflictException(
          'A sandbox role from this restore still exists; run lifecycle reconciliation before retrying',
        );
      }
      await control.query(
        `CREATE ROLE ${quotedSandbox} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${quotePgLiteral(sandboxPassword)}`,
      );
      try {
        const recorded = await control.query(
          `UPDATE ${quotePgIdentifier(RESTORE_CONTROL_SCHEMA)}.${quotePgIdentifier(RESTORE_CONTROL_TABLE)}
           SET "execution_role" = $1, "updated_at" = clock_timestamp()
           WHERE "operation_id" = $2`,
          [sandboxRole, operationId],
        );
        if (recorded.rowCount !== 1) {
          throw new Error('Restore control row is missing during sandbox setup');
        }
        await control.query(
          `GRANT CONNECT, CREATE ON DATABASE ${quotedDatabase} TO ${quotedSandbox}`,
        );
        await control.query(
          `GRANT USAGE ON SCHEMA ${quotePgIdentifier(RESTORE_CONTROL_SCHEMA)} TO ${quotedSandbox}`,
        );
        await control.query(
          `GRANT SELECT ("operation_id"), UPDATE ("phase", "updated_at") ON TABLE ${quotePgIdentifier(RESTORE_CONTROL_SCHEMA)}.${quotePgIdentifier(RESTORE_CONTROL_TABLE)} TO ${quotedSandbox}`,
        );
        await control.query(`ALTER SCHEMA public OWNER TO ${quotedSandbox}`);
      } catch (error) {
        await control
          .query(`REASSIGN OWNED BY ${quotedSandbox} TO ${quotedOwner}`)
          .catch(() => {});
        await control.query(`DROP OWNED BY ${quotedSandbox}`).catch(() => {});
        await control.query(`DROP ROLE ${quotedSandbox}`).catch(() => {});
        throw error;
      }

      const sandboxUrl = new URL(dbUrl);
      sandboxUrl.username = sandboxRole;
      sandboxUrl.password = sandboxPassword;
      return {
        parsed: parseDbUrl(sandboxUrl.toString()),
        cleanup: () =>
          this.cleanupRestoreExecutionRole(sandboxRole, controlUrl, dbUrl),
      };
    } finally {
      await control.end().catch(() => {});
    }
  }

  private async cleanupRestoreExecutionRole(
    roleName: string,
    controlUrl = process.env.BACKUP_RESTORE_DATABASE_URL ||
      process.env.DATABASE_URL,
    dbUrl = process.env.DATABASE_URL,
  ): Promise<void> {
    if (!/^ecomate_restore_[a-f0-9]{32}$/.test(roleName)) {
      throw new Error('Refusing to clean an unexpected database role');
    }
    if (!controlUrl || !dbUrl) {
      throw new Error('Database restore URLs are not configured');
    }
    const parsed = parseDbUrl(dbUrl);
    const controlTarget = parseDbUrl(controlUrl);
    if (
      controlTarget.database !== parsed.database ||
      controlTarget.host !== parsed.host ||
      controlTarget.port !== parsed.port
    ) {
      throw new Error(
        'BACKUP_RESTORE_DATABASE_URL must target the same host, port, and database as DATABASE_URL',
      );
    }
    const client = this.pgClient(
      controlTarget,
      'ecomate-restore-role-cleanup',
    );
    const quotedRole = quotePgIdentifier(roleName);
    const quotedOwner = quotePgIdentifier(parsed.user);
    await client.connect();
    try {
      const exists = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "exists"',
        [roleName],
      );
      if (exists.rows[0]?.exists) {
        const schemas = await client.query<{ name: string }>(
          `
            SELECT nspname AS "name"
            FROM pg_namespace
            WHERE pg_get_userbyid(nspowner) = $1
              AND nspname <> 'public'
              AND nspname <> 'information_schema'
              AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
          `,
          [roleName],
        );
        for (const schema of schemas.rows) {
          await client.query(
            `DROP SCHEMA ${quotePgIdentifier(schema.name)} CASCADE`,
          );
        }
        await client.query(`REASSIGN OWNED BY ${quotedRole} TO ${quotedOwner}`);
        await client.query(`DROP OWNED BY ${quotedRole}`);
        await client.query(`DROP ROLE ${quotedRole}`);
      }
      await client.query(
        `UPDATE ${quotePgIdentifier(RESTORE_CONTROL_SCHEMA)}.${quotePgIdentifier(RESTORE_CONTROL_TABLE)}
         SET "execution_role" = NULL, "updated_at" = clock_timestamp()
         WHERE "execution_role" = $1`,
        [roleName],
      );
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async cleanupRestoreExecutionRoleForOperation(
    operationId: string,
  ): Promise<void> {
    const operation = await this.getRestoreControlOperation(operationId);
    if (operation?.executionRole) {
      await this.cleanupRestoreExecutionRole(operation.executionRole);
    } else if (operation?.sourceSnapshot?.type === 'uploaded') {
      await this.cleanupRestoreExecutionRole(
        this.restoreExecutionRoleName(operationId),
      );
    }
  }

  private async applyCurrentMigrations(): Promise<void> {
    const prismaCli = require.resolve('prisma/build/index.js');
    const { stderr } = await execFileAsync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: this.restoreTimeout,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (stderr && !stderr.includes('deprecated')) {
      this.logger.warn(
        `Prisma migration warning after restore: ${stderr.slice(0, 4000)}`,
      );
    }
  }

  private snapshotData(
    snapshot: any,
    overrides: { status: string; errorMessage: string | null },
  ) {
    return {
      type: snapshot.type || 'manual',
      scope: snapshot.scope || 'db_only',
      status: overrides.status,
      fileKey: snapshot.fileKey ?? null,
      fileSize: snapshot.fileSize ?? null,
      checksum: snapshot.checksum ?? null,
      dbDumpSize: snapshot.dbDumpSize ?? null,
      filesSize: snapshot.filesSize ?? null,
      locked: snapshot.locked ?? false,
      errorMessage: overrides.errorMessage,
      startedAt: snapshot.startedAt ?? null,
      completedAt:
        overrides.status === 'completed'
          ? snapshot.completedAt || new Date()
          : (snapshot.completedAt ?? null),
    };
  }

  private async persistBackupSnapshot(
    snapshot: any,
    overrides: { status: string; errorMessage: string | null },
  ): Promise<void> {
    const data = this.snapshotData(snapshot, overrides);
    await this.prisma.backupJob.upsert({
      where: { id: snapshot.id },
      create: {
        id: snapshot.id,
        ...data,
        createdAt: snapshot.createdAt || new Date(),
      },
      update: data,
    });
  }

  private async restoreCatalogFromControl(
    control: RestoreControlOperation,
  ): Promise<void> {
    if (!control.sourceSnapshot) {
      throw new Error(
        `Committed restore ${control.operationId} has no durable source snapshot`,
      );
    }
    const source = this.deserializeBackupSnapshot(control.sourceSnapshot);
    const catalog = (control.catalogSnapshots || []).map((snapshot) =>
      this.deserializeBackupSnapshot(snapshot),
    );
    const preservedIds = new Set<string>([
      String(source.id),
      ...catalog.map((snapshot) => String(snapshot.id)),
    ]);
    await this.prisma.backupJob.deleteMany({
      where: {
        status: 'completed',
        fileKey: { not: null },
        id: { notIn: [...preservedIds] },
      },
    });
    for (const snapshot of catalog) {
      await this.persistBackupSnapshot(snapshot, {
        status: 'completed',
        errorMessage:
          typeof snapshot.errorMessage === 'string'
            ? snapshot.errorMessage
            : null,
      });
    }
    await this.persistBackupSnapshot(source, {
      status: 'completed',
      errorMessage: null,
    });
  }

  private async handleRestoreFailure(
    snapshot: any,
    error: unknown,
    preserveSource: boolean,
  ): Promise<void> {
    const message = `Restore failed: ${safeErrorMessage(error)}`;
    this.logger.error(`${message} (${snapshot.id})`);
    await this.persistBackupSnapshot(snapshot, {
      status: preserveSource ? 'completed' : 'failed',
      errorMessage: message,
    }).catch((persistError) => {
      this.logger.error(
        `Could not persist restore failure: ${safeErrorMessage(persistError)}`,
      );
    });
  }

  private localStorageKey(
    filename: string,
    url?: string | null,
    r2PublicBase?: string | null,
  ): string | null {
    let key = '';
    if (url) {
      if (this.isUrlUnderBase(url, r2PublicBase)) return null;
      if (url.startsWith('/uploads/')) {
        key = url.slice('/uploads/'.length);
      } else {
        try {
          const pathname = new URL(url).pathname;
          if (!pathname.startsWith('/uploads/')) return null;
          key = pathname.slice('/uploads/'.length);
        } catch {
          return null;
        }
      }
    }
    if (!key) key = filename || '';
    key = key.replace(/^\/?uploads\//, '');
    if (
      !key ||
      isAbsolute(key) ||
      key.includes('\0') ||
      key.split(/[\\/]/).some((part) => part === '..')
    ) {
      return null;
    }
    return key;
  }

  private derivativeLocalKey(
    url: string,
    r2PublicBase?: string | null,
  ): string | null {
    if (this.isUrlUnderBase(url, r2PublicBase)) return null;
    if (url.startsWith('/uploads/')) return url.slice('/uploads/'.length);
    try {
      const pathname = new URL(url).pathname;
      return pathname.startsWith('/uploads/')
        ? pathname.slice('/uploads/'.length)
        : null;
    } catch {
      return null;
    }
  }

  private isUrlUnderBase(value: string, base?: string | null): boolean {
    if (!base) return false;
    try {
      const url = new URL(value);
      const baseUrl = new URL(base);
      const normalizedBasePath = baseUrl.pathname.replace(/\/+$/, '');
      return (
        url.origin === baseUrl.origin &&
        (url.pathname === normalizedBasePath ||
          url.pathname.startsWith(`${normalizedBasePath}/`))
      );
    } catch {
      return false;
    }
  }

  private async repairLocalMediaAfterRestore(): Promise<void> {
    const uploadRoot = join(process.cwd(), 'uploads');
    const storageConfig = await this.storage.getConfig();
    const sharp = (await import('sharp')).default;
    const r2PublicBase =
      storageConfig.provider === 'r2' ? storageConfig.r2PublicUrl : null;
    let cursor: string | undefined;
    let requeued = 0;
    let missing = 0;
    const restoreCacheVersion = new Date();

    while (true) {
      const batch = await this.prisma.media.findMany({
        where: { mimeType: { startsWith: 'image/' } },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: 200,
        select: {
          id: true,
          filename: true,
          url: true,
          size: true,
          hash: true,
          derivativeManifest: true,
          processingStatus: true,
        },
      });
      if (batch.length === 0) break;
      const localMediaIds: string[] = [];

      for (const media of batch) {
        const originalKey = this.localStorageKey(
          media.filename,
          media.url,
          r2PublicBase,
        );
        // Direct R2/external media has no local key to repair.
        if (!originalKey) continue;
        localMediaIds.push(media.id);

        let originalError: string | null = null;
        let originalWidth: number | null = null;
        const originalPath = join(uploadRoot, originalKey);
        try {
          const info = await stat(originalPath);
          if (!info.isFile()) {
            originalError = 'Original media path is not a regular file';
          } else if (info.size !== media.size) {
            originalError =
              `Original media size mismatch after restore ` +
              `(expected ${media.size}, received ${info.size})`;
          } else if (
            media.hash &&
            (await this.hashFile(originalPath)).toLowerCase() !==
              media.hash.toLowerCase()
          ) {
            originalError = 'Original media SHA-256 mismatch after restore';
          } else {
            const metadata = await sharp(originalPath).metadata();
            if (!metadata.format || !metadata.width || !metadata.height) {
              originalError =
                'Original media is not a decodable image after restore';
            } else {
              originalWidth = metadata.width;
            }
          }
        } catch (error) {
          originalError =
            error instanceof Error && (error as NodeJS.ErrnoException).code
              ? `Original media cannot be read after restore (${(error as NodeJS.ErrnoException).code})`
              : 'Original media cannot be read after restore';
        }

        if (originalError) {
          missing += 1;
          await this.prisma.media.update({
            where: { id: media.id },
            data: {
              processingStatus: 'FAILED',
              processingError: originalError,
              derivativeManifest: Prisma.DbNull,
              blurUrl: null,
              updatedAt: new Date(),
            },
          });
          continue;
        }

        const manifest =
          media.derivativeManifest &&
          typeof media.derivativeManifest === 'object' &&
          !Array.isArray(media.derivativeManifest)
            ? (media.derivativeManifest as Record<string, unknown>)
            : null;
        let derivativesMissing =
          media.processingStatus !== 'READY' || !manifest;
        if (manifest) {
          const requiredVariants = [
            'thumbnail',
            'small',
            'medium',
            'large',
          ];
          if (
            requiredVariants.some(
              (variant) => typeof manifest[variant] !== 'string',
            )
          ) {
            derivativesMissing = true;
          }
          for (const [variantName, value] of Object.entries(manifest)) {
            if (typeof value !== 'string') {
              derivativesMissing = true;
              break;
            }
            const key = this.derivativeLocalKey(value, r2PublicBase);
            if (!key) {
              if (!this.isUrlUnderBase(value, r2PublicBase)) {
                derivativesMissing = true;
                break;
              }
              continue;
            }
            try {
              const info = await stat(join(uploadRoot, key));
              if (!info.isFile() || info.size === 0) {
                derivativesMissing = true;
                break;
              }
              const metadata = await sharp(join(uploadRoot, key)).metadata();
              const baseVariant = variantName.replace(/_jpg$/, '');
              const targetWidth = {
                thumbnail: 150,
                small: 320,
                medium: 640,
                large: 1200,
              }[baseVariant];
              const expectedWidth =
                targetWidth && originalWidth
                  ? Math.min(targetWidth, originalWidth)
                  : null;
              const expectedFormat = variantName.endsWith('_jpg')
                ? 'jpeg'
                : 'webp';
              if (
                !metadata.format ||
                !metadata.width ||
                !metadata.height ||
                (expectedWidth !== null && metadata.width !== expectedWidth) ||
                (targetWidth && metadata.format !== expectedFormat)
              ) {
                derivativesMissing = true;
                break;
              }
            } catch {
              derivativesMissing = true;
              break;
            }
          }
        }

        if (derivativesMissing) {
          await this.prisma.media.update({
            where: { id: media.id },
            data: {
              processingStatus: 'UPLOADED',
              processingError: null,
              derivativeManifest: Prisma.DbNull,
              blurUrl: null,
              updatedAt: new Date(),
            },
          });
          try {
            await this.mediaQueue.schedule(media.id);
            requeued += 1;
          } catch (error) {
            this.logger.warn(
              `Could not queue restored media ${media.id}: ${safeErrorMessage(error)}`,
            );
          }
        }
      }
      if (localMediaIds.length > 0) {
        // Every restored local URL gets a fresh cache version, including media
        // whose derivatives were present and healthy in the archive.
        await this.prisma.media.updateMany({
          where: { id: { in: localMediaIds } },
          data: { updatedAt: restoreCacheVersion },
        });
      }
      cursor = batch[batch.length - 1].id;
    }

    if (requeued || missing) {
      this.logger.log(
        `Restore media verification: requeued=${requeued}, missing/corrupt originals=${missing}`,
      );
    }
  }

  private async invalidatePostRestoreCaches(): Promise<void> {
    const prefixes = [
      'product:',
      'categories:',
      'combos:',
      'brands:',
      'storefront:',
      'analytics:',
      'courier:',
      'courier-track:',
      'pathao:',
      'delivery_areas:',
    ];
    await Promise.allSettled(
      prefixes.map((prefix) => this.cache.invalidateByPrefix(prefix)),
    );
    this.cache.clear();
  }

  async toggleLock(id: string, locked: boolean): Promise<void> {
    await this.withLifecycleLock(async (tx) => {
      const job = await tx.backupJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Backup not found');
      if (
        ['pending', 'running', 'restoring', 'deleting'].includes(job.status)
      ) {
        throw new ConflictException(
          'An active backup lifecycle record cannot be locked or unlocked',
        );
      }
      await tx.backupJob.update({
        where: { id },
        data: { locked },
      });
    });
  }

  async deleteBackup(id: string): Promise<void> {
    await this.deleteBackupRecord(id, true);
  }

  async getSetting(key: string, defaultValue?: string): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value ?? defaultValue ?? null;
  }

  async getSettingJSON<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.getSetting(key);
    if (!value) return defaultValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'backup_' } },
    });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async updateSettings(body: Record<string, string>): Promise<void> {
    const normalizedBody = { ...body };
    if (body.backup_include_paths !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(body.backup_include_paths));
      } catch {
        throw new BadRequestException(
          'backup_include_paths must be a JSON array',
        );
      }
      const normalized = normalizeBackupIncludePaths(parsed).map((path) =>
        path ? `uploads/${path}` : 'uploads',
      );
      normalizedBody.backup_include_paths = JSON.stringify(normalized);
    }
    if (
      body.backup_default_scope !== undefined &&
      !['db_only', 'db_files'].includes(body.backup_default_scope)
    ) {
      throw new BadRequestException('Invalid default backup scope');
    }
    if (
      body.backup_schedule_enabled !== undefined &&
      !['true', 'false'].includes(String(body.backup_schedule_enabled))
    ) {
      throw new BadRequestException(
        'backup_schedule_enabled must be true or false',
      );
    }
    if (body.backup_schedule_cron !== undefined) {
      this.validateBackupScheduleCron(String(body.backup_schedule_cron));
    } else if (body.backup_schedule_enabled === 'true') {
      this.validateBackupScheduleCron(
        (await this.getSetting('backup_schedule_cron', '0 2 * * *')) ||
          '0 2 * * *',
      );
    }

    for (const [key, value] of Object.entries(normalizedBody)) {
      if (!key.startsWith('backup_')) continue;
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      });
    }
    if (
      body.backup_schedule_enabled !== undefined ||
      body.backup_schedule_cron !== undefined ||
      body.backup_default_scope !== undefined
    ) {
      await this.reregisterRepeatableJob();
    }
  }

  private validateBackupScheduleCron(cron: string): void {
    try {
      parseExpression(cron, { currentDate: new Date() });
    } catch {
      throw new BadRequestException('Invalid backup schedule cron expression');
    }
  }

  private async reregisterRepeatableJob(): Promise<void> {
    const enabled = await this.getSetting('backup_schedule_enabled', 'false');
    if (enabled !== 'true') {
      const repeats = await this.backupQueue.getRepeatableJobs();
      for (const repeat of repeats) {
        if (repeat.name === 'scheduled-backup') {
          await this.backupQueue.removeRepeatableByKey(repeat.key);
        }
      }
      return;
    }

    const cron =
      (await this.getSetting('backup_schedule_cron', '0 2 * * *')) ||
      '0 2 * * *';
    this.validateBackupScheduleCron(cron);
    const configuredScope = await this.getSetting(
      'backup_default_scope',
      'db_only',
    );
    const scope: 'db_only' | 'db_files' =
      configuredScope === 'db_files' ? 'db_files' : 'db_only';
    const scheduleKey = `backup-schedule-${createHash('sha256')
      .update(`${cron}\0${scope}`)
      .digest('hex')
      .slice(0, 20)}`;

    // Publish the validated replacement first. If Redis rejects the add, the
    // previous healthy schedule remains registered.
    const scheduled = await this.backupQueue.add(
      'scheduled-backup',
      { scope, type: 'scheduled' },
      {
        repeat: { pattern: cron, key: scheduleKey },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    const repeats = await this.backupQueue.getRepeatableJobs();
    for (const repeat of repeats) {
      if (
        repeat.name === 'scheduled-backup' &&
        repeat.key !== scheduled.repeatJobKey
      ) {
        await this.backupQueue.removeRepeatableByKey(repeat.key);
      }
    }
  }

  async reconcileLifecycleJobs(): Promise<void> {
    let queuedJobs;
    try {
      queuedJobs = await this.backupQueue.getJobs([
        'active',
        'waiting',
        'delayed',
        'paused',
      ]);
    } catch (error) {
      this.logger.warn(
        `Could not inspect backup queue for lifecycle recovery: ${safeErrorMessage(error)}`,
      );
      return;
    }

    const queuedBackups = new Set<string>();
    const queuedRestores = new Set<string>();
    const queuedMigrations = new Set<string>();
    for (const job of queuedJobs) {
      const data = job.data as Partial<QueuedRestoreData> & {
        backupId?: string;
      };
      if (!data.backupId) continue;
      if (data.operation === 'restore') queuedRestores.add(data.backupId);
      else if (data.operation === 'migrate-legacy') {
        queuedMigrations.add(data.backupId);
      } else {
        queuedBackups.add(data.backupId);
      }
    }

    const orphanCutoff = new Date(
      Date.now() -
        positiveInteger(process.env.BACKUP_ORPHAN_GRACE_MS, 5 * 60 * 1000),
    );
    const active = await this.prisma.backupJob.findMany({
      where: {
        status: { in: ['pending', 'running', 'restoring'] },
        updatedAt: { lt: orphanCutoff },
      },
    });
    for (const record of active) {
      // The SQL restore itself replaces BackupJob rows with historical state,
      // so the row may temporarily say `running` while its durable Bull job is
      // still a restore. Match queue ownership by ID before interpreting the
      // restored status value.
      const hasQueueJob =
        queuedRestores.has(record.id) ||
        queuedBackups.has(record.id) ||
        queuedMigrations.has(record.id);
      if (hasQueueJob) continue;

      await this.withLifecycleLock(async (tx) => {
        const freshQueueOwner = (
          await this.backupQueue.getJobs([
            'active',
            'waiting',
            'delayed',
            'paused',
          ])
        ).some(
          (job) => (job.data as { backupId?: string }).backupId === record.id,
        );
        if (freshQueueOwner) return;
        const current = await tx.backupJob.findUnique({
          where: { id: record.id },
        });
        if (
          !current ||
          !['pending', 'running', 'restoring'].includes(current.status) ||
          current.updatedAt >= orphanCutoff
        ) {
          return;
        }
        const canReturnToCompleted =
          current.status === 'restoring' && Boolean(current.fileKey);
        await tx.backupJob.update({
          where: { id: current.id },
          data: {
            status: canReturnToCompleted ? 'completed' : 'failed',
            errorMessage:
              'Operation was interrupted and no durable queue job remains; start it again',
          },
        });
      });
    }

    const staleDeletions = await this.prisma.backupJob.findMany({
      where: { status: 'deleting', updatedAt: { lt: orphanCutoff } },
      select: { id: true },
    });
    for (const deletion of staleDeletions) {
      await this.deleteBackupRecord(deletion.id).catch((error) => {
        this.logger.warn(
          `Could not resume interrupted backup deletion ${deletion.id}: ${safeErrorMessage(error)}`,
        );
      });
    }

    const uploadRoot = join(process.cwd(), 'uploads');
    let controlOperations: RestoreControlOperation[] = [];
    try {
      const hasTable = await this.prisma.rawQuery<{ exists: boolean }>(
        `SELECT to_regclass('ecomate_control.backup_restore_operation') IS NOT NULL AS "exists"`,
      );
      if (hasTable[0]?.exists === true) {
        controlOperations = await this.listRestoreControlOperations();
      }
    } catch (error) {
      // The control plane is the authority for the DB/media commit boundary.
      // Never guess and roll files backward while it cannot be read.
      this.logger.error(
        `Could not inspect restore control plane: ${safeErrorMessage(error)}`,
      );
      return;
    }
    const interruptedOperationIds = new Set([
      ...(await listInterruptedContentRestoreIds(uploadRoot)),
      ...controlOperations.map((operation) => operation.operationId),
    ]);

    for (const operationId of interruptedOperationIds) {
      await this.withOperationFence('restore', async () => {
        const freshJobs = await this.backupQueue.getJobs([
          'active',
          'waiting',
          'delayed',
          'paused',
        ]);
        const queueOwner = freshJobs.some((job) => {
          const data = job.data as Partial<QueuedRestoreData>;
          return data.operation === 'restore' && data.backupId === operationId;
        });
        if (queueOwner) return;

        const control = await this.getRestoreControlOperation(operationId);
        if (
          control?.phase === 'database_committed' ||
          control?.phase === 'failed_after_commit'
        ) {
          await this.cleanupRestoreExecutionRoleForOperation(operationId);
          await this.applyCurrentMigrations();
          await finalizeInterruptedContentRestore(uploadRoot, operationId);
          await this.restoreCatalogFromControl(control);
          await this.repairLocalMediaAfterRestore();
          await this.invalidatePostRestoreCaches();
          await this.reregisterRepeatableJob().catch((error) => {
            this.logger.error(
              `Recovered settings contain an invalid backup schedule: ${safeErrorMessage(error)}`,
            );
          });
          await this.enqueueLegacyBackupMigrations();
          await this.clearRestoreControlOperation(operationId);
          this.logger.log(
            `Finalized committed restore ${operationId} after an interrupted worker`,
          );
          return;
        }

        // No database commit exists. A dead psql --single-transaction session
        // has rolled back, so returning the filesystem to its old bytes is the
        // only consistent outcome.
        await rollbackInterruptedContentRestore(uploadRoot, operationId, {
          ignoreFilesystemCommitMarker: Boolean(control),
        });
        if (control) {
          await this.cleanupRestoreExecutionRoleForOperation(operationId);
          await this.clearRestoreControlOperation(operationId);
        }
      }).catch((error) => {
        if (error instanceof ConflictException) return;
        this.logger.error(
          `Could not recover interrupted content restore ${operationId}: ${safeErrorMessage(error)}`,
        );
      });
    }

    await this.withLifecycleLock(
      async (tx) => {
        const freshJobs = await this.backupQueue.getJobs([
          'active',
          'waiting',
          'delayed',
          'paused',
        ]);
        const freshRestoreIds = new Set(
          freshJobs
            .map((job) => job.data as Partial<QueuedRestoreData>)
            .filter((data) => data.operation === 'restore' && data.backupId)
            .map((data) => data.backupId!),
        );
        const freshMigrationIds = new Set(
          freshJobs
            .map((job) => job.data as Partial<LegacyBackupMigrationData>)
            .filter(
              (data) => data.operation === 'migrate-legacy' && data.backupId,
            )
            .map((data) => data.backupId!),
        );
        const durableRestoreControl =
          controlOperations[0] ?? null;
        const maintenanceOwner =
          freshRestoreIds.size > 0 || durableRestoreControl
            ? { id: freshRestoreIds.values().next().value ?? 'restore-control' }
            : await tx.backupJob.findFirst({
                where: {
                  ...(freshMigrationIds.size > 0
                    ? { id: { notIn: [...freshMigrationIds] } }
                    : {}),
                  OR: [
                    { status: 'restoring' },
                    { status: 'running', scope: 'db_files' },
                  ],
                },
                select: { id: true },
              });
        if (maintenanceOwner) return;
        await this.leaveMaintenance().catch(() => {});
        await this.mediaQueue.resume().catch(() => {});
        await this.resumeMaintenanceQueues().catch(() => {});
      },
      2 * 60 * 1000,
    );
  }

  private async enqueueLegacyBackupMigrations(): Promise<void> {
    const legacyBackups = await this.prisma.backupJob.findMany({
      where: {
        fileKey: { startsWith: 'backups/' },
        status: { in: ['completed', 'failed'] },
      },
      select: { id: true, fileKey: true },
    });

    for (const backup of legacyBackups) {
      if (!backup.fileKey) continue;
      await this.backupQueue.add(
        'migrate-legacy',
        {
          operation: 'migrate-legacy',
          backupId: backup.id,
          legacyKey: backup.fileKey,
        } satisfies LegacyBackupMigrationData,
        {
          jobId: `legacy-migrate-${backup.id}`,
          attempts: 100,
          backoff: { type: 'fixed', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }

    if (legacyBackups.length > 0) {
      this.logger.log(
        `Queued ${legacyBackups.length} legacy backup artifact(s) for private-storage migration`,
      );
    }
  }

  async onModuleInit(): Promise<void> {
    await this.reconcileLifecycleJobs();
    await this.backupQueue.add(
      'lifecycle-recovery',
      { operation: 'reconcile' },
      {
        repeat: { every: 60_000 },
        jobId: 'backup-lifecycle-recovery',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await this.reregisterRepeatableJob().catch((error) => {
      // A malformed legacy value must not make every backend restart fail.
      // The existing repeat entry is retained because registration validates
      // before removing it.
      this.logger.error(
        `Could not register backup schedule: ${safeErrorMessage(error)}`,
      );
    });
    await this.enqueueLegacyBackupMigrations();
  }
}
