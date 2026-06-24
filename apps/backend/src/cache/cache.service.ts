import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTtl = 300_000;
  private redis: Redis | null = null;

  constructor() {
    const host = process.env['REDIS_HOST'];
    if (host) {
      this.redis = new Redis({
        host,
        port: Number(process.env['REDIS_PORT']) || 6379,
        password: process.env['REDIS_PASSWORD'] || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });
      this.redis.connect().catch(() => {
        this.redis = null;
        console.warn('[Cache] Redis unavailable — using memory fallback');
      });
    }
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) return JSON.parse(raw) as T;
      } catch { /* fall through to memory */ }
    }
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    const ttlSeconds = ttlMs ? Math.ceil(ttlMs / 1000) : Math.ceil(this.defaultTtl / 1000);
    if (this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(data));
        return;
      } catch { /* fall through to memory */ }
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtl),
    });
  }

  async delete(key: string): Promise<void> {
    if (this.redis) {
      try { await this.redis.del(key); } catch { /* ignore */ }
    }
    this.store.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
