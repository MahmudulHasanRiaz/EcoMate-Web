import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface CourierTokenIssuer {
  courier: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

/**
 * Persistent OAuth access-token store for courier APIs (Pathao).
 *
 * The official Pathao Merchant API issues access tokens with
 * `expires_in: 432000` (5 days) plus a `refresh_token`. Re-issuing a token
 * with the password grant on every API call is wasteful and is a known
 * source of intermittent failures. This service stores tokens in
 * `CourierAuthToken` (durable across restarts) + a volatile Redis copy
 * (fast path), and refreshes via the `refresh_token` grant, falling back to
 * the password grant when the refresh grant fails (expired refresh token,
 * revoked credentials, …).
 *
 * Concurrent callers are deduped: at most one token fetch runs per courier
 * at any moment, the rest await the same promise.
 */
@Injectable()
export class CourierTokenService {
  private readonly logger = new Logger(CourierTokenService.name);
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  getVolatileCacheKey(courier: string): string {
    return `courier:token:${courier}`;
  }

  async getAccessToken(opts: CourierTokenIssuer): Promise<string> {
    const key = this.getVolatileCacheKey(opts.courier);

    if (this.inflight.has(key)) return this.inflight.get(key)!;

    const promise = this.fetchValidToken(opts).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchValidToken(opts: CourierTokenIssuer): Promise<string> {
    const cacheKey = this.getVolatileCacheKey(opts.courier);

    // 1. Volatile fast path (Redis): valid for the current process lifetime.
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    // 2. Durable store: restart-safe, avoids re-auth after a deploy.
    const row = await this.prisma.courierAuthToken.findUnique({
      where: { courier: opts.courier },
    });
    if (row?.accessToken && new Date(row.expiresAt).getTime() > Date.now() + FIFTEEN_MINUTES_MS) {
      await this.cache.set(cacheKey, row.accessToken, (new Date(row.expiresAt).getTime() - Date.now()) * 1000);
      return row.accessToken;
    }

    // 3. Refresh grant — reuses the persisted refresh token (docs:
    //    POST /aladdin/api/v1/issue-token with grant_type=refresh_token).
    if (row?.refreshToken) {
      try {
        const refreshed = await this.issueToken(opts, {
          grant_type: 'refresh_token',
          refresh_token: row.refreshToken,
        });
        await this.persist(opts.courier, refreshed);
        return refreshed.access_token;
      } catch (err) {
        this.logger.warn(
          `Courier "${opts.courier}" refresh_token grant failed (${(err as Error).message?.slice(0, 120)}); falling back to password grant`,
        );
      }
    }

    // 4. Password grant — first-time or after refresh failure.
    const issued = await this.issueToken(opts, {
      grant_type: 'password',
      username: opts.username,
      password: opts.password,
    });
    await this.persist(opts.courier, issued);
    return issued.access_token;
  }

  private async issueToken(
    opts: CourierTokenIssuer,
    body: Record<string, string>,
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const res = await fetch(`${opts.baseUrl}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        ...body,
      }),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`HTTP ${res.status} ${detail}`);
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const accessToken = String(data.access_token || '');
    if (!accessToken) throw new Error('Courier token fetch returned no token');

    return {
      access_token: accessToken,
      refresh_token: String(data.refresh_token || ''),
      expires_in: Number(data.expires_in || 3600),
    };
  }

  private async persist(
    courier: string,
    issued: { access_token: string; refresh_token: string; expires_in: number },
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + Math.max(0, issued.expires_in - 60) * 1000);

    await this.prisma.courierAuthToken.upsert({
      where: { courier },
      update: {
        accessToken: issued.access_token,
        refreshToken: issued.refresh_token || undefined,
        expiresAt,
      },
      create: {
        courier,
        accessToken: issued.access_token,
        refreshToken: issued.refresh_token || undefined,
        expiresAt,
      },
    });

    await this.cache.set(this.getVolatileCacheKey(courier), issued.access_token, Math.max(0, issued.expires_in - 60) * 1000);
  }
}