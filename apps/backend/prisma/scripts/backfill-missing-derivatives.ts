/**
 * Missing-derivatives backfill for existing media.
 *
 * READY image rows whose derivativeManifest is null/empty (legacy rows
 * that predate the derivative pipeline, or URL-import clones created
 * before the clone inherited the manifest) are invisible to the AVIF
 * backfill — it deliberately skips manifest-less rows — so the
 * storefront serves their raw originals (multi-MB banners included).
 * This enqueues the SAME media 'process' job for every such row
 * (MediaQueueService.backfillMissingDerivatives); the processor
 * generates the full WebP set + AVIF siblings + blur, so it is
 * idempotent and safe to re-run.
 *
 * The backend also runs this pass automatically shortly after boot
 * (disable with MEDIA_BACKFILL_ON_BOOT=0), so a redeploy normally
 * self-heals a tenant library without this script.
 *
 * DRY-RUN is the default: counts scanned/missing and queues nothing.
 * --apply actually queues. Alternatively call the admin API:
 *   POST /media/backfill-derivatives  { "dryRun": true|false }  (maintain_media)
 *
 * Usage:
 *   cd apps/backend
 *   npx tsx prisma/scripts/backfill-missing-derivatives.ts [--apply] [--max=1000]
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
    const result = await media.backfillMissingDerivatives({
      dryRun: !apply,
      max,
    });
    console.log(
      `[backfill-missing-derivatives] scanned=${result.scanned} missing=${result.missing} queued=${result.queued} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
    );
    if (!apply && result.missing > 0) {
      console.log(
        '[backfill-missing-derivatives] re-run with --apply to queue generation',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[backfill-missing-derivatives] failed:', err);
  process.exit(1);
});
