import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { BlockSettingsService } from '../block-settings/block-settings.service';
import { SecurityEventEmitterService } from '../security-dashboard/services/security-event-emitter.service';
import { SecurityEventType } from '../security-dashboard/registries/event-type.registry';
import { SecurityEventSource } from '../security-dashboard/registries/source.registry';
import Redis from 'ioredis';

@Injectable()
export class SecurityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecurityService.name);
  private redis: Redis | null = null;
  private isRedisConnected = false;

  private failedLoginsFallback = new Map<
    string,
    { count: number; firstAttempt: number }
  >();
  private ipOrderCountsFallback = new Map<
    string,
    { count: number; firstOrder: number }
  >();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockedEntries: BlockedEntriesService,
    private readonly blockSettings: BlockSettingsService,
    private readonly eventEmitter: SecurityEventEmitterService,
  ) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(() => {});
    }, 60_000);
  }

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
      });

      this.redis.on('connect', () => {
        this.isRedisConnected = true;
        this.logger.log('Connected to Redis for distributed rate limiting');
      });

      this.redis.on('error', (err) => {
        this.isRedisConnected = false;
        this.logger.warn(
          `Redis connection error, falling back to in-memory: ${err.message}`,
        );
      });
    } catch (err: any) {
      this.isRedisConnected = false;
      this.logger.warn(`Failed to initialize Redis client: ${err.message}`);
    }
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    if (this.redis) {
      this.redis.disconnect();
    }
  }

  async recordFailedLogin(ip: string) {
    const now = Date.now();
    const settings = await this.blockSettings.getSettings();
    const threshold = settings.autoBlock.failedLoginThreshold;
    const windowMs =
      (settings.autoBlock.failedLoginWindowMinutes || 10) * 60_000;
    const windowSec = Math.ceil(windowMs / 1000);

    let count = 0;
    let firstAttempt = now;
    let redisSucceeded = false;

    if (this.isRedisConnected && this.redis) {
      const key = `ratelimit:login:${ip}`;
      try {
        const pipeline = this.redis.pipeline();
        pipeline.incr(key);
        pipeline.ttl(key);
        const results = await pipeline.exec();

        if (results && results[0] && results[1]) {
          count = results[0][1] as number;
          const ttl = results[1][1] as number;

          if (count === 1 || ttl === -1) {
            await this.redis.expire(key, windowSec);
            firstAttempt = now;
          } else {
            firstAttempt = now - (windowMs - ttl * 1000);
          }
          redisSucceeded = true;
        }
      } catch (err: any) {
        this.logger.error(
          `Redis recordFailedLogin failed, falling back: ${err.message}`,
        );
        this.isRedisConnected = false;
      }
    }

    if (!redisSucceeded) {
      const entry = this.failedLoginsFallback.get(ip) || {
        count: 0,
        firstAttempt: now,
      };
      entry.count++;
      if (entry.count === 1) entry.firstAttempt = now;
      this.failedLoginsFallback.set(ip, entry);
      count = entry.count;
      firstAttempt = entry.firstAttempt;
    }

    if (count >= threshold && now - firstAttempt <= windowMs) {
      if (this.isRedisConnected && this.redis) {
        await this.redis.del(`ratelimit:login:${ip}`).catch(() => {});
      } else {
        this.failedLoginsFallback.delete(ip);
      }

      // Fire-and-forget: emit failed login threshold exceeded event
      this.eventEmitter.emit({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: 'HIGH' as any,
        category: 'AUTH' as any,
        source: SecurityEventSource.SECURITY_SERVICE,
        actorType: ('IP' as any),
        ipAddress: ip,
        description: `Failed login threshold exceeded for IP ${ip}: ${count}/${threshold} attempts`,
        riskScore: count,
        metadata: { attemptCount: count, threshold },
        retentionOverride: false,
      }).catch(() => {});

      if (settings.autoBlock.autoFullBlockIp) {
        this.logger.warn(
          `Auto full-blocking IP ${ip} (${count} failed logins)`,
        );
        await this.blockedEntries.createAutoBlock('ip', ip, 'full', 1440);

        this.eventEmitter.emit({
          eventType: SecurityEventType.AUTO_BLOCK_CREATED,
          severity: 'CRITICAL' as any,
          category: 'BLOCK' as any,
          source: SecurityEventSource.SECURITY_SERVICE,
          actorType: ('SYSTEM' as any),
          ipAddress: ip,
          description: `Auto full-blocked IP ${ip}: ${count} failed logins exceeded threshold ${threshold}`,
          metadata: { reason: 'failed_login_threshold', attemptCount: count },
          retentionOverride: true,
        }).catch(() => {});
      }
    }
  }

  async recordOrder(phone: string, ip: string) {
    const settings = await this.blockSettings.getSettings();

    if (settings.autoBlock?.autoOrderBlockPhone && phone) {
      const count = await this.blockedEntries.countPhoneOrders(
        phone,
        settings.phoneOrderRestriction.timeWindowMinutes,
      );
      if (count >= settings.phoneOrderRestriction.maxOrders) {
        this.logger.warn(
          `Auto order-blocking phone ${phone} (${count} orders)`,
        );
        await this.blockedEntries.createAutoBlock(
          'phone',
          phone,
          'order',
          settings.phoneOrderRestriction.blockDurationMinutes,
        );

        this.eventEmitter.emit({
          eventType: SecurityEventType.AUTO_BLOCK_CREATED,
          severity: 'HIGH' as any,
          category: 'FRAUD' as any,
          source: SecurityEventSource.SECURITY_SERVICE,
          actorType: ('SYSTEM' as any),
          phone,
          description: `Auto order-blocked phone ${phone}: ${count} orders in ${settings.phoneOrderRestriction.timeWindowMinutes}min window`,
          metadata: { reason: 'order_threshold', orderCount: count },
          retentionOverride: true,
        }).catch(() => {});
      }
    }

    if (settings.autoBlock?.autoOrderBlockIp && ip) {
      const windowMs =
        (settings.ipOrderRestriction.timeWindowMinutes || 60) * 60_000;
      const windowSec = Math.ceil(windowMs / 1000);
      let count = 0;
      const now = Date.now();
      let firstOrder = now;
      let redisSucceeded = false;

      if (this.isRedisConnected && this.redis) {
        const key = `ratelimit:order:${ip}`;
        try {
          const pipeline = this.redis.pipeline();
          pipeline.incr(key);
          pipeline.ttl(key);
          const results = await pipeline.exec();

          if (results && results[0] && results[1]) {
            count = results[0][1] as number;
            const ttl = results[1][1] as number;

            if (count === 1 || ttl === -1) {
              await this.redis.expire(key, windowSec);
              firstOrder = now;
            } else {
              firstOrder = now - (windowMs - ttl * 1000);
            }
            redisSucceeded = true;
          }
        } catch (err: any) {
          this.logger.error(
            `Redis recordOrder failed, falling back: ${err.message}`,
          );
          this.isRedisConnected = false;
        }
      }

      if (!redisSucceeded) {
        const entry = this.ipOrderCountsFallback.get(ip) || {
          count: 0,
          firstOrder: now,
        };
        entry.count++;
        if (entry.count === 1) entry.firstOrder = now;
        if (now - entry.firstOrder > windowMs) {
          entry.count = 1;
          entry.firstOrder = now;
        }
        this.ipOrderCountsFallback.set(ip, entry);
        count = entry.count;
      }

      if (count >= settings.ipOrderRestriction.maxOrders) {
        if (this.isRedisConnected && this.redis) {
          await this.redis.del(`ratelimit:order:${ip}`).catch(() => {});
        } else {
          this.ipOrderCountsFallback.delete(ip);
        }
        this.logger.warn(`Auto order-blocking IP ${ip} (${count} orders)`);
        await this.blockedEntries.createAutoBlock(
          'ip',
          ip,
          'order',
          settings.ipOrderRestriction.blockDurationMinutes,
        );

        this.eventEmitter.emit({
          eventType: SecurityEventType.AUTO_BLOCK_CREATED,
          severity: 'HIGH' as any,
          category: 'FRAUD' as any,
          source: SecurityEventSource.SECURITY_SERVICE,
          actorType: ('SYSTEM' as any),
          ipAddress: ip,
          description: `Auto order-blocked IP ${ip}: ${count} orders in ${settings.ipOrderRestriction.timeWindowMinutes}min window`,
          metadata: { reason: 'order_threshold', orderCount: count },
          retentionOverride: true,
        }).catch(() => {});
      }
    }
  }

  async getBlockInfo(phone?: string, ip?: string) {
    const settings = await this.blockSettings.getSettings();
    const result: any = { blocked: false };

    if (ip) {
      const fullBlock = await this.blockedEntries.findFullBlockedIp(ip);
      if (fullBlock) {
        result.blocked = true;
        result.type = 'full_block_ip';
        result.message = settings.blockMessages.fullBlockIp;
        return result;
      }
      const orderBlock = await this.blockedEntries.findOrderBlockedIp(ip);
      if (orderBlock) {
        result.blocked = true;
        result.type = 'order_block_ip';
        result.message = settings.blockMessages.orderBlockIp;
        return result;
      }
    }

    if (phone) {
      const phoneBlock = await this.blockedEntries.findBlockedPhone(phone);
      if (phoneBlock) {
        result.blocked = true;
        result.type = 'order_block_phone';
        result.message = settings.blockMessages.orderBlockPhone;
        return result;
      }
    }

    return result;
  }

  async getAutoBlockStats() {
    try {
      const [ipActive, ipAuto, phoneActive, phoneAuto] = await Promise.all([
        this.prisma.blockedIp.count({ where: { isActive: true } }),
        this.prisma.blockedIp.count({
          where: { isActive: true, autoBlocked: true },
        }),
        this.prisma.blockedPhone.count({ where: { isActive: true } }),
        this.prisma.blockedPhone.count({
          where: { isActive: true, autoBlocked: true },
        }),
      ]);
      return {
        ipBlocks: { total: ipActive, auto: ipAuto },
        phoneBlocks: { total: phoneActive, auto: phoneAuto },
      };
    } catch (err: any) {
      this.logger.error(`Failed to fetch auto-block stats: ${err.message}`);
      return {
        ipBlocks: { total: 0, auto: 0 },
        phoneBlocks: { total: 0, auto: 0 },
      };
    }
  }

  private async cleanup() {
    try {
      const settings = await this.blockSettings.getSettings();
      const now = Date.now();

      const loginWindowMs =
        (settings.autoBlock.failedLoginWindowMinutes || 10) * 60_000;
      for (const [ip, entry] of this.failedLoginsFallback.entries()) {
        if (now - entry.firstAttempt > loginWindowMs) {
          this.failedLoginsFallback.delete(ip);
        }
      }

      const orderWindowMs =
        (settings.ipOrderRestriction.timeWindowMinutes || 60) * 60_000;
      for (const [ip, entry] of this.ipOrderCountsFallback.entries()) {
        if (now - entry.firstOrder > orderWindowMs) {
          this.ipOrderCountsFallback.delete(ip);
        }
      }
    } catch {
      // If settings can't be fetched, skip cleanup this cycle
    }
  }
}
