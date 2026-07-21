import {
  Injectable,
  Logger,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { TrustTier } from './trust-tier.enum';
import { RATE_LIMIT_POLICY_KEY, RateLimitResult } from './rate-limit-policy.interface';
import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { TrustTierService } from './trust-tier.service';
import { RateLimitCounterService } from './rate-limit-counter.service';
import { RiskContextService } from './risk-context.service';
import { RiskScoreService } from './risk-score.service';
import { SecurityEventEmitterService } from '../../security-dashboard/services/security-event-emitter.service';
import { SecurityEventType } from '../../security-dashboard/registries/event-type.registry';
import { SecurityEventSource } from '../../security-dashboard/registries/source.registry';

const WHITELIST_IDENTITIES = new Set<string>();

export function setWhitelistedIdentity(identity: string) {
  WHITELIST_IDENTITIES.add(identity);
}

export function removeWhitelistedIdentity(identity: string) {
  WHITELIST_IDENTITIES.delete(identity);
}

@Injectable()
export class AdaptiveRateLimiterGuard {
  private readonly logger = new Logger(AdaptiveRateLimiterGuard.name);
  private readonly tenant: string;
  private whitelistCache = new Map<string, { whitelisted: boolean; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly reflector: Reflector,
    private readonly policyStore: RateLimitPolicyStore,
    private readonly tierService: TrustTierService,
    private readonly counter: RateLimitCounterService,
    private readonly riskContext: RiskContextService,
    private readonly riskScore: RiskScoreService,
    private readonly eventEmitter: SecurityEventEmitterService,
  ) {
    this.tenant = process.env.RATE_LIMIT_TENANT || 'default';
    this.cleanupTimer = setInterval(() => this.whitelistCache.clear(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const handler = context.getHandler();
    const controllerClass = context.getClass();

    const policyName = this.resolvePolicy(handler, controllerClass, request);
    const policy = this.policyStore.get(policyName);

    // 1. Trust tier detection
    const { tier, identity } = this.tierService.determine(request);

    // 2. Whitelist check (modifier, not separate tier)
    const ip = this.tierService.extractIp(request);
    const isWhitelisted = await this.checkWhitelisted(ip, identity);

    // 3. Resolve counter key
    const trackingKey = policy.trackingKey === 'ip'
      ? this.counter.buildKey(this.tenant, policyName, tier, `ip:${ip}`)
      : this.counter.buildKey(this.tenant, policyName, tier, identity);

    const tierLimit = policy.limits[tier] || policy.limits[TrustTier.UNKNOWN];

    // 4. Apply whitelist modifier (higher threshold, not unlimited)
    const effectiveLimit = isWhitelisted
      ? { limit: Math.round(tierLimit.limit * 5), windowMs: tierLimit.windowMs }
      : tierLimit;

    // 5. Check burst first
    let burstRemaining = Infinity;
    if (policy.burst) {
      const burstKey = this.counter.buildKey(this.tenant, policyName, `${tier}:burst`, identity);
      const burstResult = await this.counter.increment(
        burstKey,
        isWhitelisted
          ? Math.round(policy.burst.limit * 5)
          : policy.burst.limit,
        policy.burst.windowMs,
      );
      burstRemaining = burstResult.remaining;
    }

    // 6. Main counter
    const result = await this.counter.increment(
      trackingKey,
      effectiveLimit.limit,
      effectiveLimit.windowMs,
    );

    // 7. If exceeded, block unless burst is still available
    if (result.count > effectiveLimit.limit && (!policy.burst || burstRemaining <= 0)) {
      await this.handleExceeded(request, reply, result, policy, identity, ip, isWhitelisted);

      // Fire-and-forget: emit rate-limit exceeded event (never blocks response)
      this.eventEmitter.emit({
        eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
        severity: 'HIGH' as any,
        category: 'RATE_LIMIT' as any,
        source: SecurityEventSource.ADAPTIVE_RATE_LIMITER,
        actorType: identity.startsWith('user:') ? ('USER' as any) : identity.startsWith('sess:') ? ('SESSION' as any) : identity.startsWith('bt:') ? ('BROWSER_TRUST' as any) : ('IP' as any),
        ipAddress: ip,
        userId: identity.startsWith('user:') ? identity.slice(5) : null,
        sessionId: identity.startsWith('sess:') ? identity.slice(5) : null,
        browserTrustId: identity.startsWith('bt:') ? identity.slice(3) : null,
        trustTier: tier,
        description: `Rate limit exceeded on policy "${policy.name}"`,
        retentionOverride: false,
      }).catch(() => {});

      return false;
    }

    // 8. Set session cookie for UNKNOWN-tier visitors (promote to SESSION next request)
    if (tier === TrustTier.UNKNOWN && !request.cookies?.['_rm_sess']) {
      const sessionCookie = this.tierService.createSessionCookieValue();
      reply.setCookie('_rm_sess', sessionCookie.value, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 86400,
      });
    }

    // 9. Set rate limit headers
    const remaining = Math.min(result.remaining, burstRemaining);
    reply.header('X-RateLimit-Limit', effectiveLimit.limit.toString());
    reply.header('X-RateLimit-Remaining', Math.max(0, remaining).toString());
    reply.header('X-RateLimit-Reset', (Date.now() + result.resetMs).toString());
    reply.header('X-RateLimit-Policy', policy.name);
    reply.header('X-RateLimit-Tier', tier);

    return true;
  }

  private async handleExceeded(
    request: FastifyRequest,
    reply: FastifyReply,
    result: RateLimitResult | { count: number; remaining: number; resetMs: number },
    policy: any,
    identity: string,
    ip: string,
    isWhitelisted: boolean,
  ): Promise<void> {
    reply.header('Retry-After', Math.ceil(result.resetMs / 1000).toString());
    reply.status(429);
    reply.send({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      retryAfterMs: result.resetMs,
      policy: policy.name,
    });

    // Risk score accumulation — not immediate auto-block
    await this.riskScore.recordViolation(identity, ip, policy, isWhitelisted);
  }

  private resolvePolicy(
    handler: any,
    controllerClass: any,
    request: FastifyRequest,
  ): string {
    const fromHandler = this.reflector.get<string>(RATE_LIMIT_POLICY_KEY, handler);
    if (fromHandler) return fromHandler;

    const fromClass = this.reflector.get<string>(RATE_LIMIT_POLICY_KEY, controllerClass);
    if (fromClass) return fromClass;

    const path = request.url;
    if (path?.startsWith('/api/auth/')) return 'auth';
    if (path?.startsWith('/api/payments/') || path?.startsWith('/api/bkash/')) return 'checkout';
    if (path?.startsWith('/api/health')) return 'health';
    if (path?.startsWith('/api/admin/')) return 'admin';
    if (path?.startsWith('/api/pos/')) return 'pos';
    if (path?.startsWith('/api/webhook/')) return 'webhooks';
    if (path?.startsWith('/api/rate-limit/browser-check')) return 'browser_check';

    return 'api';
  }

  private async checkWhitelisted(ip: string, identity?: string): Promise<boolean> {
    // Check in-memory cache first
    const cached = this.whitelistCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.whitelisted;
    }
    // Check WHITELIST_IDENTITIES set (used by admin management)
    if (WHITELIST_IDENTITIES.has(ip) || (identity && WHITELIST_IDENTITIES.has(identity))) {
      this.whitelistCache.set(ip, { whitelisted: true, expiresAt: Date.now() + 60000 });
      return true;
    }
    return false;
  }

  invalidateWhitelistCache() {
    this.whitelistCache.clear();
  }
}
