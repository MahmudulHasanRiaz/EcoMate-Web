import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from '../backup/backup.service';
import {
  ReconciliationFinderService,
  ReconCheck,
  ReconReport,
} from './reconciliation-finder.service';
import {
  ReconcileApplyResult,
  ReconciliationApplyService,
} from './reconciliation-apply.service';
import { Q8SettleService } from './q8-settle.service';

export interface ReconciliationFixAllInput {
  performedBy: string;
  isSuperAdmin: boolean;
  /** Must be exactly true — enforced here, not only by the controller. */
  confirmed: boolean;
}

export type FixAllSettleResult =
  | {
      ran: true;
      releasedUnits: number;
      flagsCleared: number;
      ledgerEntries: string[];
      remainingFails: number;
      detail: string;
    }
  | { ran: false; reason: string };

export interface ReconciliationFixAllResult {
  backupId: string;
  apply: {
    runId: string;
    applied: string[];
    skipped: { id: string; reason: string }[];
    idempotency: ReconcileApplyResult['idempotency'];
  };
  settle: FixAllSettleResult;
  postReport: { counts: ReconReport['counts']; checks: ReconCheck[] };
  generatedAt: string;
}

/**
 * How long the auto-backup may take before fix-all gives up WITHOUT
 * writing anything (spec: poll every 2s, up to 100s).
 */
export const FIX_ALL_BACKUP_POLL_INTERVAL_MS = 2_000;
export const FIX_ALL_BACKUP_TIMEOUT_MS = 100_000;

/** Same staleness bound as ReconciliationApplyService: a RUNNING record
 * older than this is a crashed run, not a concurrent one (apply's own
 * sweep marks it FAILED), so the pre-check ignores it instead of
 * bricking fix-all forever on a stale row. */
const RUNNING_STALE_MS = 30 * 60 * 1000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reconciliation ONE-CLICK FIX (2026-11-12, recon simplification round).
 *
 * One button for the ordinary user: auto-backup → apply the
 * evidence-backed rows (R1/R2/R6/R8, same predicate as the guarded
 * Apply) → Q8 settle (superadmin only) → fresh post-fix report.
 *
 * Safety invariants (inherited, never bypassed):
 * - The write path is still ReconciliationApplyService.apply() with its
 *   own gates (non-empty backupId, confirmed === true, flag-off env,
 *   advisory-lock concurrency) — fix-all satisfies them, never skips
 *   them. R7 / R8-H / R4 are excluded by construction here AND refused
 *   again inside apply(); R8 backfill never fabricates (unchanged
 *   apply service); every write goes through ledger entries.
 * - NOTHING is written unless the auto-backup completed first: a failed
 *   or timed-out backup throws before apply() is ever called.
 * - The backup is scope 'db_only': reconciliation writes are DB-only,
 *   and db_files would pause the media + background queues for no
 *   benefit. The completed BackupJob id is the real id recorded on the
 *   ReconciliationRun by apply() and returned to the UI — no typed id.
 */
@Injectable()
export class ReconciliationFixAllService {
  private readonly logger = new Logger(ReconciliationFixAllService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly finder: ReconciliationFinderService,
    private readonly reconApply: ReconciliationApplyService,
    private readonly backupService: BackupService,
    private readonly q8Settle: Q8SettleService,
    /**
     * Test seam only (Nest passes nothing here): poll cadence / budget
     * for the auto-backup wait. Production defaults are the exported
     * FIX_ALL_BACKUP_* constants above.
     */
    private readonly options: {
      pollIntervalMs?: number;
      pollTimeoutMs?: number;
    } = {},
  ) {}

  private get pollIntervalMs(): number {
    return this.options.pollIntervalMs ?? FIX_ALL_BACKUP_POLL_INTERVAL_MS;
  }

  private get pollTimeoutMs(): number {
    return this.options.pollTimeoutMs ?? FIX_ALL_BACKUP_TIMEOUT_MS;
  }

  async fixAll(
    input: ReconciliationFixAllInput,
  ): Promise<ReconciliationFixAllResult> {
    if (input.confirmed !== true) {
      throw new BadRequestException(
        'Fix-all requires confirmed=true — preview the report and confirm first.',
      );
    }

    // Early fail-closed: a live run is already in progress. The apply
    // service's advisory lock remains the authoritative guard; this just
    // avoids creating a backup for a run that cannot proceed.
    const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
    const running = await this.prisma.reconciliationRun.findFirst({
      where: { status: 'RUNNING', createdAt: { gte: staleBefore } },
      select: { id: true },
    });
    if (running) {
      throw new ConflictException(
        'Another reconciliation run is already in progress — wait for it to finish.',
      );
    }

    // Auto-backup (db_only) + wait for completion. NOTHING is applied
    // unless this returns a completed job with a fileKey.
    const backupId = await this.startAndWaitForBackup();

    // Fresh report; applicable rows use exactly apply's predicate:
    // R1/R2/R6, or R8 with r8Kind !== 'human'. R7 and R8-H are excluded
    // by construction; R3/R4 are never applicable.
    const report = await this.finder.buildReport();
    const rowIds = report.rows
      .filter(
        (row) =>
          row.category === 'R1' ||
          row.category === 'R2' ||
          row.category === 'R6' ||
          (row.category === 'R8' && row.r8Kind !== 'human'),
      )
      .map((row) => row.id);

    const applyResult = await this.reconApply.apply({
      performedBy: input.performedBy,
      backupId,
      confirmed: true,
      rowIds,
    });

    // Q8 settle AFTER apply: apply's R6 heal changes residue first, and
    // settle entries are ignored by the R6 finder (PR #209), so the
    // order matters. Superadmin only — everyone else gets the reason
    // and runs it from the details view.
    let settle: FixAllSettleResult;
    if (input.isSuperAdmin) {
      const settled = await this.q8Settle.settle({
        dryRun: false,
        performedBy: input.performedBy,
      });
      settle = {
        ran: true,
        releasedUnits: settled.settled.releasedUnits,
        flagsCleared: settled.settled.flagsCleared,
        ledgerEntries: settled.settled.ledgerEntries,
        remainingFails: settled.remainingFails,
        detail: settled.detail,
      };
    } else {
      settle = {
        ran: false,
        reason:
          'Q8 settle needs a superadmin — run it from the details view.',
      };
    }

    const postReport = await this.finder.buildReport();
    this.logger.log(
      `Reconciliation fix-all by ${input.performedBy} (backup ${backupId}): ` +
        `applied ${applyResult.applied.length}, skipped ${applyResult.skipped.length}, ` +
        `settle ${settle.ran ? 'ran' : 'skipped (non-superadmin)'}.`,
    );
    return {
      backupId,
      apply: {
        runId: applyResult.runId,
        applied: applyResult.applied,
        skipped: applyResult.skipped,
        idempotency: applyResult.idempotency,
      },
      settle,
      postReport: { counts: postReport.counts, checks: postReport.checks },
      generatedAt: postReport.generatedAt,
    };
  }

  /**
   * Enqueues a db_only manual backup and polls until it completes with
   * a fileKey. Throws (and therefore writes nothing) when the backup
   * fails or does not finish inside the timeout.
   */
  private async startAndWaitForBackup(): Promise<string> {
    const { id: backupId } = await this.backupService.triggerManual('db_only');
    const startedAt = Date.now();
    for (;;) {
      const job = await this.backupService.getBackup(backupId);
      if (job.status === 'completed' && job.fileKey) return backupId;
      if (job.status === 'failed') {
        throw new Error(
          `Automatic backup ${backupId} failed` +
            (job.errorMessage ? `: ${job.errorMessage}` : '') +
            ' — nothing was applied.',
        );
      }
      if (Date.now() - startedAt >= this.pollTimeoutMs) {
        throw new Error(
          `Automatic backup ${backupId} did not finish within ` +
            `${this.pollTimeoutMs / 1000}s — nothing was applied.`,
        );
      }
      await sleep(this.pollIntervalMs);
    }
  }
}
