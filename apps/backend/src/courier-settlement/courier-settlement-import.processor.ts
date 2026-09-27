// ── Background import worker (§17): runs commit() for large invoices that
// were claimed into IMPORTING by commitOrSchedule(). Progress columns
// (importProgress / importStage) are polled by the admin while the job runs.
//
// Idempotency: the queue jobId is `cs-commit-<invoiceId>` (BullMQ forbids `:`
// in custom job ids); commit() re-accepts
// the IMPORTING state and the existingRows guard inside its transaction makes a
// replay harmless. A retry after a post-commit failure hits ConflictException
// (already imported) and is treated as success.

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { CourierSettlementInvoiceState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { CourierSettlementImportService } from './courier-settlement-import.service';

export interface CourierSettlementImportJob {
  invoiceId: string;
  actor: string | null;
  previousState: CourierSettlementInvoiceState;
}

@Processor('courier-settlement-import')
export class CourierSettlementImportProcessor extends WorkerHost {
  private readonly logger = new Logger(CourierSettlementImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: CourierSettlementImportService,
  ) {
    super();
  }

  async process(job: Job<CourierSettlementImportJob>): Promise<void> {
    const { invoiceId, actor, previousState } = job.data;
    this.logger.log(`Importing invoice ${invoiceId} in the background`);
    await this.stage(invoiceId, 15, 'preparing');
    try {
      await this.imports.commit(invoiceId, actor);
      await this.stage(invoiceId, 100, 'done');
    } catch (e) {
      if (e instanceof ConflictException) {
        // Replayed after the rows already landed — honest success.
        await this.stage(invoiceId, 100, 'done');
        return;
      }
      // Release the claim so the operator can retry from the UI; BullMQ keeps
      // retrying this job (attempts/backoff from the root queue config).
      await this.prisma.courierSettlementInvoice
        .updateMany({
          where: { id: invoiceId, state: 'IMPORTING' },
          data: { state: previousState, importProgress: 0, importStage: 'failed' },
        })
        .catch(() => undefined);
      this.logger.error(`Background import failed for ${invoiceId}: ${(e as Error).message}`);
      throw e;
    }
  }

  private async stage(invoiceId: string, progress: number, stage: string): Promise<void> {
    await this.prisma.courierSettlementInvoice.updateMany({
      where: { id: invoiceId },
      data: { importProgress: progress, importStage: stage },
    });
  }
}
