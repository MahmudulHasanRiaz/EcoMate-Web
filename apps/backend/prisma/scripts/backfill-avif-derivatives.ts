/**
 * P3 AVIF backfill for existing media (speed plan §6, task 3).
 *
 * Existing rows carry WebP-only derivative manifests. This enqueues the
 * SAME media 'process' job for every READY image whose manifest has no
 * `*_avif` keys (MediaQueueService.backfillAvif) — the processor
 * regenerates the identical WebP keys plus AVIF siblings, so it is
 * idempotent and safe to re-run; rows already carrying AVIF are skipped.
 *
 * DRY-RUN is the default: counts scanned/missing and queues nothing.
 * --apply actually queues. Alternatively call the admin API:
 *   POST /media/backfill-avif  { "dryRun": true|false }  (maintain_media)
 *
 * Usage:
 *   cd apps/backend
 *   npx tsx prisma/scripts/backfill-avif-derivatives.ts [--apply] [--max=1000]
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { MediaService } from '../../src/media/media.service';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const max = maxArg ? Number(maxArg.split('=')[1]) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const media = app.get(MediaService);
    const result = await media.backfillAvif({ dryRun: !apply, max });
    console.log(
      `[backfill-avif] scanned=${result.scanned} missingAvif=${result.missing} queued=${result.queued} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
    );
    if (!apply && result.missing > 0) {
      console.log('[backfill-avif] re-run with --apply to queue generation');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[backfill-avif] failed', err);
  process.exit(1);
});
