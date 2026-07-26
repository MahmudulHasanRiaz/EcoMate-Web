import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_MEMORY_ENTRIES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

@Injectable()
export class CacheService implements OnModuleDestroy {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTtl = 300_000;
  private redis: Redis | null = null;
  private readonly sharedConfigured =
    Boolean(process.env['REDIS_URL']) || Boolean(process.env['REDIS_HOST']);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const redisUrl = process.env['REDIS_URL'];
    const host = process.env['REDIS_HOST'];
    if (host || redisUrl) {
      const sharedOptions = {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => Math.min(times * 100, 3000),
      };
      // Passing REDIS_URL directly preserves ACL usernames, TLS, and the
      // selected Redis database path (for example redis://user:pass@host/2).
      try {
        this.redis =
          !host && redisUrl
            ? new Redis(redisUrl, sharedOptions)
            : new Redis({
                host: host!,
                port: Number(process.env['REDIS_PORT']) || 6379,
                password: process.env['REDIS_PASSWORD'] || undefined,
                ...sharedOptions,
              });
      } catch {
        this.redis = null;
        console.warn(
          '[Cache] Invalid Redis configuration — using memory fallback',
        );
      }
      if (!this.redis) {
        this.startCleanupTimer();
        return;
      }
      this.redis.connect().catch(() => {
        this.redis = null;
        console.warn('[Cache] Redis unavailable — using memory fallback');
      });
    }
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      CLEANUP_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    this.redis?.disconnect();
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  async getStale<T>(key: string): Promise<T | undefined> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    const effectiveTtl = ttlMs ?? this.defaultTtl;
    // Always keep a local mirror. If Redis disappears while a destructive
    // restore is running, the owning API process must not fail open.
    if (this.store.size >= MAX_MEMORY_ENTRIES) {
      this.evictExpired();
      if (this.store.size >= MAX_MEMORY_ENTRIES) {
        const eldest = this.store.keys().next().value;
        if (eldest) this.store.delete(eldest);
      }
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + effectiveTtl,
    });

    const ttlSeconds = ttlMs
      ? Math.ceil(ttlMs / 1000)
      : Math.ceil(this.defaultTtl / 1000);
    if (this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(data));
        return;
      } catch {
        /* fall through to memory */
      }
    }
  }

  isSharedAvailable(): boolean {
    return this.redis?.status === 'ready';
  }

  async delete(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        /* ignore */
      }
    }
    this.store.delete(key);
  }

  async invalidateByPrefix(prefix: string): Promise<void> {
    if (this.redis) {
      try {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            `${prefix}*`,
            'COUNT',
            100,
          );
          if (keys.length) await this.redis.del(...keys);
          cursor = nextCursor;
        } while (cursor !== '0');
      } catch {
        /* fall through to memory */
      }
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async countByPrefix(
    prefix: string,
    options: { requireShared?: boolean } = {},
  ): Promise<number> {
    this.evictExpired();
    const keys = new Set(
      [...this.store.keys()].filter((key) => key.startsWith(prefix)),
    );

    if (this.redis?.status === 'ready') {
      try {
        let cursor = '0';
        do {
          const [nextCursor, page] = await this.redis.scan(
            cursor,
            'MATCH',
            `${prefix}*`,
            'COUNT',
            100,
          );
          for (const key of page) keys.add(key);
          cursor = nextCursor;
        } while (cursor !== '0');
      } catch (error) {
        if (options.requireShared) throw error;
      }
    } else if (options.requireShared && this.sharedConfigured) {
      throw new Error(
        'Shared cache is unavailable while checking active writes',
      );
    }

    return keys.size;
  }

  clear(): void {
    this.store.clear();
  }
}
