import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

interface CounterEntry {
  count: number;
  firstHit: number;
}

@Injectable()
export class RateLimitCounterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitCounterService.name);
  private redis: Redis | null = null;
  private isRedisConnected = false;
  private inMemory = new Map<string, CounterEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
      });
      this.redis.on('connect', () => { this.isRedisConnected = true; });
      this.redis.on('error', (err) => {
        this.isRedisConnected = false;
        this.logger.warn(`Redis error (rate-limit counter): ${err.message}`);
      });
    } catch {
      this.logger.warn('Redis unavailable for rate-limit counter, using in-memory');
    }

    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);

    // Log deployment mode on construction
    if (this.isRedisConnected) {
      this.logger.log('Rate-limit counter: Redis connected');
    } else {
      this.logger.warn(
        'Rate-limit counter: Redis unavailable — using in-memory fallback. '
        + 'Single-instance OK for dev. Multi-instance deployments REQUIRE Redis '
        + 'for correct rate limiting across replicas.',
      );
    }
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    this.redis?.disconnect();
  }

  /**
   * Build a counter key from tenant, policy, tier, and resolved identity.
   * Identity priority: userId → sessionId → browserTrust nonce → IP
   */
  buildKey(tenant: string, policy: string, tier: string, identity: string): string {
    return `rl:${tenant}:${policy}:${tier}:${identity}`;
  }

  /**
   * Increment counter and return current count + remaining info.
   */
  async increment(
    key: string,
    maxCount: number,
    windowMs: number,
  ): Promise<{ count: number; remaining: number; resetMs: number }> {
    if (this.isRedisConnected && this.redis) {
      return this.redisIncrement(key, maxCount, windowMs);
    }
    return this.memoryIncrement(key, maxCount, windowMs);
  }

  private async redisIncrement(
    key: string,
    maxCount: number,
    windowMs: number,
  ): Promise<{ count: number; remaining: number; resetMs: number }> {
    try {
      const windowSec = Math.ceil(windowMs / 1000);
      const pipeline = this.redis!.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);
      const results = await pipeline.exec();
      if (!results) throw new Error('Pipeline returned null');

      const count = results[0][1] as number;
      let ttl = results[1][1] as number;

      if (count === 1 || ttl === -1) {
        await this.redis!.expire(key, windowSec);
        ttl = windowSec;
      }

      return {
        count,
        remaining: Math.max(0, maxCount - count),
        resetMs: ttl * 1000,
      };
    } catch (err: any) {
      this.isRedisConnected = false;
      this.logger.warn(`Redis fallback in counter: ${err.message}`);
      return this.memoryIncrement(key, maxCount, windowMs);
    }
  }

  private memoryIncrement(
    key: string,
    maxCount: number,
    windowMs: number,
  ): { count: number; remaining: number; resetMs: number } {
    const now = Date.now();
    let entry = this.inMemory.get(key);

    if (!entry || now - entry.firstHit > windowMs) {
      entry = { count: 0, firstHit: now };
      this.inMemory.set(key, entry);
    }

    entry.count++;
    const elapsed = now - entry.firstHit;
    const resetMs = Math.max(0, windowMs - elapsed);

    return {
      count: entry.count,
      remaining: Math.max(0, maxCount - entry.count),
      resetMs,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.inMemory.entries()) {
      if (now - entry.firstHit > 120_000) {
        this.inMemory.delete(key);
      }
    }
  }
}
