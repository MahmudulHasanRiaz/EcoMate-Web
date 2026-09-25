/**
 * Repeated-failure notifications — central-commerce P11 (§11 Sync Center UX,
 * §12 observability).
 *
 * Sends an operational email through the globally-available
 * `EmailQueueService` when a `StoreSyncIssue` crosses the repeated-failure
 * threshold. Fail-safe by design: missing recipient, missing queue, or a
 * send failure NEVER throws into the sync engine (R-2 style) — the failure
 * is logged and the sync result stands.
 *
 * Recipient resolution (first hit wins):
 * 1. `SYNC_FAILURE_NOTIFY_EMAIL` env (explicit ops inbox)
 * 2. `ADMIN_EMAIL` env (existing seed/admin convention)
 * 3. newest `superadmin` user email (best-effort DB lookup)
 * Absent all three → skip with a debug log (visible, never silent).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../queue/email-queue/email-queue.service';
import { logSync } from './store-sync-logger';

/** Notify once at 5 occurrences, then every 10 (5, 15, 25, …) — no spam. */
export const REPEATED_FAILURE_NOTIFY_THRESHOLD = 5;

export function shouldNotifyRepeatedFailure(occurrences: number): boolean {
  if (!Number.isFinite(occurrences) || occurrences < REPEATED_FAILURE_NOTIFY_THRESHOLD) return false;
  if (occurrences === REPEATED_FAILURE_NOTIFY_THRESHOLD) return true;
  return (occurrences - REPEATED_FAILURE_NOTIFY_THRESHOLD) % 10 === 0;
}

@Injectable()
export class SyncNotifyService {
  private readonly logger = new Logger(SyncNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailQueue?: EmailQueueService,
  ) {}

  async notifyIfRepeated(storeId: string, issue: { code: string; objectKey: string; occurrences: number; message: string }): Promise<boolean> {
    if (!shouldNotifyRepeatedFailure(issue.occurrences)) return false;
    const to = await this.resolveRecipient();
    if (!to) {
      this.logger.debug(`sync-notify: no recipient for repeated failure ${issue.code} (store ${storeId}) — skipped`);
      return false;
    }
    if (!this.emailQueue) {
      this.logger.warn(`sync-notify: EmailQueue unavailable — repeated failure ${issue.code} x${issue.occurrences} not emailed`);
      return false;
    }
    try {
      const store = await this.prisma.store.findUnique({ where: { id: storeId } }).catch(() => null);
      const storeName = (store as any)?.name ?? storeId;
      await this.emailQueue.send({
        to,
        subject: `[EcoMate sync] ${issue.code} repeated ${issue.occurrences}x on ${storeName}`,
        template: 'notification',
        context: {
          content: [
            `Store: ${storeName} (${storeId})`,
            `Issue: ${issue.code}`,
            `Object: ${issue.objectKey}`,
            `Occurrences: ${issue.occurrences}`,
            `Latest: ${issue.message}`,
            `Open the Sync Center → Issues to resolve or ignore with a note.`,
          ].join('\n'),
        },
      });
      logSync(this.logger, 'log', 'sync-notify: repeated-failure email queued', {
        storeId,
        status: issue.code,
        objectKey: issue.objectKey,
      });
      return true;
    } catch (err) {
      // Never propagate into the sync engine.
      logSync(this.logger, 'warn', `sync-notify: email send failed (non-propagating): ${err}`, { storeId });
      return false;
    }
  }

  private async resolveRecipient(): Promise<string | null> {
    const envHit = process.env['SYNC_FAILURE_NOTIFY_EMAIL'] ?? process.env['ADMIN_EMAIL'];
    if (envHit && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(envHit)) return envHit;
    try {
      const admin = await (this.prisma as any).user?.findFirst?.({
        where: { role: 'superadmin' },
        orderBy: { createdAt: 'desc' },
        select: { email: true },
      });
      if (admin?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) return admin.email;
    } catch {
      // Best-effort only.
    }
    return null;
  }
}
