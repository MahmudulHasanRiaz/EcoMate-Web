import { Module } from '@nestjs/common';
import { CachePurgeController } from './cache-purge.controller';
import { CachePurgeService } from './cache-purge.service';

/**
 * "Purge all cache" module (P0 stale-bundle round, 2026-11-12).
 * CacheModule and PrismaModule are both @Global, so no imports needed.
 * The service is exported so the SW-fix follow-up (or a future
 * deploy hook) can trigger a purge programmatically.
 */
@Module({
  controllers: [CachePurgeController],
  providers: [CachePurgeService],
  exports: [CachePurgeService],
})
export class CachePurgeModule {}
