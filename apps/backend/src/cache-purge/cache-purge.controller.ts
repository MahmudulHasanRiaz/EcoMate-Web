import { Controller, Get, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CachePurgeService } from './cache-purge.service';

/**
 * "Purge all cache" endpoints (P0 stale-bundle round, 2026-11-12).
 *
 * POST /cache-purge is superadmin-only (global RolesGuard). No
 * @RequiresFeature: this is a superadmin ops tool, not a licensed
 * feature — it must never 403 on a tenant whose plan lacks a key.
 *
 * GET /cache-purge/version is public so every client (admin bundles,
 * the storefront, a not-yet-updated PWA) can read the current cache
 * version without a session and reload when it changes.
 */
@Controller('cache-purge')
export class CachePurgeController {
  constructor(private readonly purge: CachePurgeService) {}

  @Post()
  @Roles('superadmin')
  purgeAll() {
    return this.purge.purgeAll();
  }

  @Public()
  @Get('version')
  getCacheVersion() {
    return this.purge.getCacheVersion();
  }
}
