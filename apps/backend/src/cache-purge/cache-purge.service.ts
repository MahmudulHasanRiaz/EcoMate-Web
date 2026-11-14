import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "Purge all cache" — the manual escape hatch for stale devices
 * (P0 stale-bundle round, 2026-11-12).
 *
 * A server-side button CANNOT clear a specific phone's browser cache.
 * What it can do is purge every server/CDN layer and bump a cache
 * version every client checks: devices running a bundle that contains
 * the version check (apps/admin/src/lib/cache-version.ts) reload on
 * their next visit. Devices still stuck on a pre-check bundle cannot be
 * woken by the bump alone — that is what the parallel SW fix on this
 * branch is for. This boundary is stated in the confirmation dialog,
 * the result copy and the PR body, not hidden.
 *
 * Layers (each reported honestly — never a silent success):
 *  1. backendCache — CacheService.clearAll(): in-memory + shared Redis,
 *     except protected keys (BullMQ jobs, rate-limit counters).
 *  2. cloudflare — POST purge_everything to api.cloudflare.com for this
 *     tenant's zone(s) only. Needs CLOUDFLARE_API_TOKEN (Zone:Cache Purge)
 *     + CLOUDFLARE_ZONE_ID (comma-separated for several zones), both
 *     server-side env, never in the client bundle, never logged. When
 *     unset the layer reports `not_configured` with the owner-side step.
 *  3. storefront — POST the storefront's /api/revalidate (tags products,
 *     config) with the shared REVALIDATION_SECRET. When unset the layer
 *     reports `not_configured`.
 *  4. versionBump — upserts SystemSetting `cache_version` to a strictly
 *     increasing value. Runs LAST and always: a failure in another layer
 *     must never stop the bump. A bump failure itself is reported as a
 *     failed layer (never a 500) and the returned version is the
 *     last-known stored value, so the button remembers truthfully.
 *
 * Tenant scope: zones come from this tenant's own env, the storefront
 * URL from this tenant's own `storefront_url` setting / STOREFRONT_URL /
 * CLIENT_DOMAIN. Nothing is hardcoded, no wildcard/all-zones purge.
 */
export const CACHE_VERSION_KEY = 'cache_version';

export type PurgeLayerStatus =
  | 'purged'
  | 'skipped'
  | 'failed'
  | 'not_configured';

export interface PurgeLayerResult {
  status: PurgeLayerStatus;
  detail: string;
}

export interface PurgeAllResult {
  purgedAt: string;
  version: string;
  storefrontUrl: string;
  layers: {
    backendCache: PurgeLayerResult;
    cloudflare: PurgeLayerResult;
    storefront: PurgeLayerResult;
    versionBump: PurgeLayerResult;
  };
}

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const FETCH_TIMEOUT_MS = 10_000;

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class CachePurgeService {
  private readonly logger = new Logger(CachePurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Current cache version, or null when no purge has ever run. */
  async getCacheVersion(): Promise<{ version: string | null }> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: CACHE_VERSION_KEY },
    });
    return { version: row?.value ?? null };
  }

  /**
   * Purge every layer. Each layer is attempted independently and its
   * outcome reported; a failure in one layer never aborts the rest.
   */
  async purgeAll(): Promise<PurgeAllResult> {
    const purgedAt = new Date().toISOString();
    const storefrontUrl = await this.resolveStorefrontUrl();

    const backendCache = await this.purgeBackendCache();
    const cloudflare = await this.purgeCloudflare();
    const storefront = await this.revalidateStorefront(storefrontUrl);
    const { version, result: versionBump } = await this.bumpVersion();

    // Log the outcome, never any credential. Token/secret values are
    // never interpolated into a detail string either (see tests).
    this.logger.log(
      `Cache purge: backend=${backendCache.status} cloudflare=${cloudflare.status} ` +
        `storefront=${storefront.status} version=${version}`,
    );

    return {
      purgedAt,
      version,
      storefrontUrl,
      layers: { backendCache, cloudflare, storefront, versionBump },
    };
  }

  private async purgeBackendCache(): Promise<PurgeLayerResult> {
    try {
      const cleared = await this.cache.clearAll();
      if (!cleared.redisAvailable && this.cacheHasSharedBackend()) {
        return {
          status: 'failed',
          detail:
            `Cleared ${cleared.memoryCleared} in-memory entries, but the ` +
            `shared cache (Redis) could not be reached, so its entries ` +
            `were NOT cleared.`,
        };
      }
      const redisPart = cleared.redisAvailable
        ? ` and deleted ${cleared.redisDeleted} shared-cache (Redis) keys`
        : `. No shared cache (Redis) is configured, so there was nothing else to clear`;
      const keptPart =
        cleared.redisSkipped > 0
          ? ` ${cleared.redisSkipped} protected keys were kept (job queues and rate-limit counters).`
          : '';
      return {
        status: 'purged',
        detail:
          `Cleared ${cleared.memoryCleared} in-memory entries${redisPart}.${keptPart}`,
      };
    } catch (error) {
      return {
        status: 'failed',
        detail: `Could not clear the backend cache: ${safeMessage(error)}`,
      };
    }
  }

  /** Whether a shared Redis backend is configured at all. */
  private cacheHasSharedBackend(): boolean {
    return Boolean(process.env['REDIS_URL'] || process.env['REDIS_HOST']);
  }

  private async purgeCloudflare(): Promise<PurgeLayerResult> {
    const token = process.env['CLOUDFLARE_API_TOKEN'];
    const zoneIds = (process.env['CLOUDFLARE_ZONE_ID'] || '')
      .split(',')
      .map((z) => z.trim())
      .filter(Boolean);
    if (!token || zoneIds.length === 0) {
      return {
        status: 'not_configured',
        detail:
          'Cloudflare is not configured for this tenant — set ' +
          'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID. ' +
          'The Cloudflare edge cache was NOT purged.',
      };
    }
    // Attempt EVERY configured zone: one zone's failure must not skip
    // the rest (nit fixed in the SW-fix round, 2026-11-12 — the old
    // loop returned failed on the first bad zone). Zone ids are
    // identifiers, not secrets (see PR body), so a failed zone is
    // named in the detail for the superadmin reading the result.
    const failures: string[] = [];
    let purgedCount = 0;
    for (const zoneId of zoneIds) {
      try {
        const res = await fetch(
          `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneId)}/purge_cache`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ purge_everything: true }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) {
          const message =
            body?.errors?.[0]?.message || `Cloudflare returned HTTP ${res.status}`;
          failures.push(`${zoneId}: ${message}`);
        } else {
          purgedCount++;
        }
      } catch (error) {
        // Network / timeout for this zone only — keep purging the rest.
        failures.push(`${zoneId}: ${safeMessage(error)}`);
      }
    }
    if (failures.length > 0) {
      return {
        status: 'failed',
        detail:
          `Cloudflare purge failed for ${failures.length} of ${zoneIds.length} ` +
          `zone${zoneIds.length === 1 ? '' : 's'}` +
          (purgedCount > 0 ? ` (${purgedCount} purged)` : '') +
          `: ${failures.join('; ')}`,
      };
    }
    return {
      status: 'purged',
      detail: `Purged everything in ${zoneIds.length} Cloudflare zone${zoneIds.length === 1 ? '' : 's'}.`,
    };
  }

  /**
   * Ask the storefront to revalidate its `products` + `config` caches
   * (POST /api/revalidate). Public so a settings save that changes a
   * crawler-facing value (canonical_domain) can trigger it directly
   * instead of waiting out the storefront's revalidate windows — the
   * purge-all button is the manual form of the same call. Never throws:
   * a failed / not-configured revalidation is reported, never fatal to
   * the caller (a settings save must not fail because the storefront
   * could not be reached).
   */
  async revalidateStorefront(
    storefrontUrl?: string,
  ): Promise<PurgeLayerResult> {
    const url = storefrontUrl ?? (await this.resolveStorefrontUrl());
    const secret = process.env['REVALIDATION_SECRET'];
    if (!secret) {
      return {
        status: 'not_configured',
        detail:
          'Storefront revalidation is not configured — set ' +
          'REVALIDATION_SECRET (same value on the backend and the ' +
          'storefront). The storefront page cache was NOT revalidated.',
      };
    }
    try {
      const revalidateUrl = `${url.replace(/\/$/, '')}/api/revalidate?tags=products,config`;
      const res = await fetch(revalidateUrl, {
        method: 'POST',
        headers: { 'x-revalidation-secret': secret },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          detail:
            `Storefront revalidation failed (HTTP ${res.status})` +
            (text ? `: ${text.slice(0, 200)}` : '.'),
        };
      }
      this.logger.log('Storefront revalidated (tags products,config).');
      return {
        status: 'purged',
        detail:
          'Asked the storefront to revalidate the products and config caches.',
      };
    } catch (error) {
      return {
        status: 'failed',
        detail: `Storefront revalidation failed: ${safeMessage(error)}`,
      };
    }
  }

  private async bumpVersion(): Promise<{
    version: string;
    result: PurgeLayerResult;
  }> {
    // A bump failure must not 500 the whole endpoint (nit fixed in the
    // SW-fix round, 2026-11-12): the other layers already ran and are
    // reported, so the bump is one failed layer. The returned version
    // is the last-known STORED value ('' when even the read failed) —
    // never the un-stored next value — so the button's
    // rememberCacheVersion stores what the server actually has.
    let previous: string | null = null;
    try {
      const current = await this.prisma.systemSetting.findUnique({
        where: { key: CACHE_VERSION_KEY },
      });
      previous = current?.value ?? null;
      const prev = Number.parseInt(current?.value ?? '', 10);
      const next = String(
        Math.max(Date.now(), Number.isFinite(prev) ? prev + 1 : 0),
      );
      await this.prisma.systemSetting.upsert({
        where: { key: CACHE_VERSION_KEY },
        update: { value: next },
        create: { key: CACHE_VERSION_KEY, value: next },
      });
      return {
        version: next,
        result: {
          status: 'purged',
          detail:
            `Cache version is now ${next}. Devices running the latest ` +
            `admin bundle will reload on their next visit.`,
        },
      };
    } catch (error) {
      return {
        version: previous ?? '',
        result: {
          status: 'failed',
          detail:
            `Could not bump the cache version: ${safeMessage(error)}. ` +
            `Devices running the latest admin bundle will NOT reload on ` +
            `their next visit until a purge succeeds.`,
        },
      };
    }
  }

  /**
   * This tenant's storefront URL, same resolution chain as
   * SystemSettingsController.getStorefrontConfig: stored
   * `storefront_url` setting first, then STOREFRONT_URL, then
   * https://CLIENT_DOMAIN. Never hardcoded.
   */
  private async resolveStorefrontUrl(): Promise<string> {
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: 'storefront_url' },
    });
    return (
      stored?.value ||
      process.env['STOREFRONT_URL'] ||
      (process.env['CLIENT_DOMAIN']
        ? `https://${process.env['CLIENT_DOMAIN']}`
        : 'http://localhost:3000')
    );
  }
}
