import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AdaptiveRateLimiterGuard, setWhitelistedIdentity, removeWhitelistedIdentity } from './adaptive-rate-limiter.guard';
import { TrustTierService } from './trust-tier.service';
import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { RateLimitCounterService } from './rate-limit-counter.service';
import { RiskContextService } from './risk-context.service';
import { RiskScoreService } from './risk-score.service';
import { TrustTier } from './trust-tier.enum';
import type { RateLimitPolicy } from './rate-limit-policy.interface';
import { SecurityEventEmitterService } from '../../security-dashboard/services/security-event-emitter.service';

const DEFAULT_POLICY: RateLimitPolicy = {
  name: 'test',
  limits: {
    [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
    [TrustTier.SESSION]: { limit: 50, windowMs: 60000 },
    [TrustTier.BROWSER_TRUST]: { limit: 30, windowMs: 60000 },
    [TrustTier.AUTHENTICATED]: { limit: 100, windowMs: 60000 },
  },
  burst: { limit: 5, windowMs: 10000 },
  riskScore: { violationWeight: 1, autoBlockThreshold: 10, autoBlockDurationMinutes: 5 },
  trackingKey: 'identity',
};

/**
 * Build per-policy-name policies so guard header matches expectations.
 */
function policyFor(name: string): RateLimitPolicy {
  return {
    ...DEFAULT_POLICY,
    name,
    limits: {
      [TrustTier.UNKNOWN]: name === 'health' || name === 'browser_check'
        ? { limit: 100, windowMs: 60000 }
        : { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 50, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 30, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 100, windowMs: 60000 },
    },
  };
}

// ─── Mock declarations ───────────────────────────────────────────────────────

const mockReflector = { get: jest.fn() };
const mockPolicyStore = { get: jest.fn() };
const mockTierService = {
  determine: jest.fn(),
  extractIp: jest.fn(),
  createSessionCookieValue: jest.fn(),
};
const mockCounter = {
  buildKey: jest.fn(),
  increment: jest.fn(),
};
const mockRiskContext = {};
const mockRiskScore = { recordViolation: jest.fn() };

// Module-level reply — reassigned in beforeEach, captured by makeCtx at call time
let reply: FastifyReply;

function makeReq(cookies?: Record<string, string>, url = ''): FastifyRequest {
  return {
    cookies: cookies || {},
    url,
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply {
  let statusCode = 200;
  let sentBody: any = null;
  const headers: Record<string, string> = {};
  return {
    header: jest.fn((k: string, v: string) => { headers[k] = v; }),
    status: jest.fn((c: number) => { statusCode = c; return reply; }),
    send: jest.fn((b: any) => { sentBody = b; }),
    setCookie: jest.fn(),
    get headers() { return headers; },
    get statusCode() { return statusCode; },
    get sentBody() { return sentBody; },
  } as unknown as FastifyReply;
}

function makeCtx(req: FastifyRequest) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => reply,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
}

let guard: AdaptiveRateLimiterGuard;

async function createGuard() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdaptiveRateLimiterGuard,
      { provide: Reflector, useValue: mockReflector },
      { provide: RateLimitPolicyStore, useValue: mockPolicyStore },
      { provide: TrustTierService, useValue: mockTierService },
      { provide: RateLimitCounterService, useValue: mockCounter },
      { provide: RiskContextService, useValue: mockRiskContext },
      { provide: RiskScoreService, useValue: mockRiskScore },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
      { provide: SecurityEventEmitterService, useValue: { emit: jest.fn().mockResolvedValue({ id: 'test', dedupKey: 'test', enqueued: true }) } },
    ],
  }).compile();
  return module.get<AdaptiveRateLimiterGuard>(AdaptiveRateLimiterGuard);
}

function setupDefaultMocks() {
  mockPolicyStore.get.mockImplementation((name?: string) => policyFor(name || 'test'));
  mockTierService.determine.mockReturnValue({ tier: TrustTier.UNKNOWN, identity: 'ip:127.0.0.1' });
  mockTierService.extractIp.mockReturnValue('127.0.0.1');
  mockTierService.createSessionCookieValue.mockReturnValue({ value: 'sess.cookie.val', id: 'sess1' });
  mockCounter.increment = jest.fn().mockResolvedValue({ count: 1, remaining: 9, resetMs: 50000 });
  mockCounter.buildKey = jest.fn().mockReturnValue('rl:default:test:unknown:ip:127.0.0.1');
  mockRiskScore.recordViolation = jest.fn();
  setWhitelistedIdentity('ip:127.0.0.1');
  removeWhitelistedIdentity('ip:127.0.0.1');
}

beforeEach(async () => {
  reply = makeReply();
  guard = await createGuard();
  setupDefaultMocks();
});

afterEach(() => {
  guard.onModuleDestroy();
});

// ─── 1. TRUST TIER RESOLUTION ────────────────────────────────────────────────

describe('Trust Tier Resolution', () => {
  it('resolves UNKNOWN when no cookies or auth', async () => {
    mockReflector.get.mockReturnValue('test');

    const allowed = await guard.canActivate(makeCtx(makeReq({}, '/api/test')));

    expect(allowed).toBe(true);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Tier', 'unknown');
  });

  it('resolves BROWSER_TRUST when valid _rm_bt cookie present', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.BROWSER_TRUST, identity: 'bt:nonce123' });
    mockReflector.get.mockReturnValue('test');

    const allowed = await guard.canActivate(makeCtx(makeReq({ _rm_bt: 'valid.cookie' })));

    expect(allowed).toBe(true);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Tier', 'browser_trust');
  });

  it('resolves SESSION when valid _rm_sess cookie present', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.SESSION, identity: 'sess:sid123' });
    mockReflector.get.mockReturnValue('test');

    const allowed = await guard.canActivate(makeCtx(makeReq({ _rm_sess: 'valid.session' })));

    expect(allowed).toBe(true);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Tier', 'session');
  });

  it('resolves AUTHENTICATED when user is present', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.AUTHENTICATED, identity: 'user:abc123' });
    mockReflector.get.mockReturnValue('test');

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    expect(allowed).toBe(true);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Tier', 'authenticated');
  });
});

// ─── 2. RATE LIMITING AT EACH TIER ───────────────────────────────────────────

describe('Rate Limiting Per Tier', () => {
  it('blocks when limit exceeded and no burst capacity', async () => {
    mockReflector.get.mockReturnValue('test');
    // Both main limit and burst exhausted
    mockCounter.increment
      .mockResolvedValueOnce({ count: 99, remaining: 0, resetMs: 30000 })  // burst call
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 30000 }); // main call (10 limit)

    const allowed = await guard.canActivate(makeCtx(makeReq({}, '/api/test')));

    expect(allowed).toBe(false);
    expect(reply.statusCode).toBe(429);
  });

  it('allows request under limit for all tiers', async () => {
    mockReflector.get.mockReturnValue('test');

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    expect(allowed).toBe(true);
  });

  it('uses tier-specific limits', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.AUTHENTICATED, identity: 'user:abc' });
    mockReflector.get.mockReturnValue('test');
    // Counter returns count=50 — under AUTHENTICATED limit (100) but over UNKNOWN (10)
    mockCounter.increment
      .mockResolvedValueOnce({ count: 1, remaining: 99, resetMs: 50000 })  // burst
      .mockResolvedValueOnce({ count: 50, remaining: 50, resetMs: 50000 }); // main

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    expect(allowed).toBe(true);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
  });

  it('returns 429 body with retry info', async () => {
    mockReflector.get.mockReturnValue('test');
    mockCounter.increment
      .mockResolvedValueOnce({ count: 99, remaining: 0, resetMs: 30000 })
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 30000 });

    await guard.canActivate(makeCtx(makeReq({}, '/api/test')));

    expect(reply.sentBody).toMatchObject({ statusCode: 429 });
    expect(reply.sentBody).toHaveProperty('retryAfterMs');
    expect(reply.sentBody).toHaveProperty('policy', 'test');
  });
});

// ─── 3. SESSION COOKIE PROMOTION ─────────────────────────────────────────────

describe('Session Cookie Promotion', () => {
  it('sets _rm_sess for UNKNOWN tier on first request', async () => {
    mockReflector.get.mockReturnValue('test');

    await guard.canActivate(makeCtx(makeReq({}, '/api/test')));

    expect(reply.setCookie).toHaveBeenCalledWith('_rm_sess', 'sess.cookie.val', expect.objectContaining({
      httpOnly: true,
      path: '/',
      maxAge: 86400,
    }));
  });

  it('does not set _rm_sess when already present', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.SESSION, identity: 'sess:existing' });
    mockReflector.get.mockReturnValue('test');

    await guard.canActivate(makeCtx(makeReq({ _rm_sess: 'existing.cookie' })));

    expect(reply.setCookie).not.toHaveBeenCalledWith('_rm_sess', expect.any(String), expect.any(Object));
  });

  it('does not set _rm_sess for AUTHENTICATED tier', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.AUTHENTICATED, identity: 'user:abc' });
    mockReflector.get.mockReturnValue('test');

    await guard.canActivate(makeCtx(makeReq({})));

    expect(reply.setCookie).not.toHaveBeenCalled();
  });
});

// ─── 4. RATE LIMIT HEADERS ───────────────────────────────────────────────────

describe('Rate Limit Headers', () => {
  it('includes all standard rate limit headers', async () => {
    mockReflector.get.mockReturnValue('test');

    await guard.canActivate(makeCtx(makeReq({})));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '9');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'test');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Tier', 'unknown');
  });

  it('sends Retry-After when rate limited', async () => {
    mockReflector.get.mockReturnValue('test');
    mockCounter.increment
      .mockResolvedValueOnce({ count: 99, remaining: 0, resetMs: 30000 })
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 30000 });

    await guard.canActivate(makeCtx(makeReq({})));

    expect(reply.header).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(reply.statusCode).toBe(429);
  });
});

// ─── 5. BURST HANDLING ───────────────────────────────────────────────────────

describe('Burst Handling', () => {
  it('allows request when main limit exceeded but burst available', async () => {
    mockReflector.get.mockReturnValue('test');
    // Burst still has capacity (count=3, limit=5)
    // Main is at count=11 (>10 limit)
    mockCounter.increment
      .mockResolvedValueOnce({ count: 3, remaining: 2, resetMs: 8000 })
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 50000 });

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    // Should be allowed because burst is still available
    expect(allowed).toBe(true);
  });

  it('blocks when both main and burst exceeded', async () => {
    mockReflector.get.mockReturnValue('test');
    mockCounter.increment
      .mockResolvedValueOnce({ count: 6, remaining: 0, resetMs: 8000 })   // burst (limit 5)
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 50000 }); // main (limit 10)

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    expect(allowed).toBe(false);
    expect(reply.statusCode).toBe(429);
  });

  it('blocks when main exceeded and no burst policy', async () => {
    mockPolicyStore.get.mockImplementation((name?: string) => {
      const p = policyFor(name || 'test');
      delete (p as any).burst;
      return p;
    });
    mockReflector.get.mockReturnValue('test');
    // Only one counter call since no burst policy
    mockCounter.increment
      .mockResolvedValueOnce({ count: 99, remaining: 0, resetMs: 30000 })  // burst not consumed
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 30000 }); // main

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    // Without burst policy, exceeding main limit should block
    expect(allowed).toBe(false);
    expect(reply.statusCode).toBe(429);
  });
});

// ─── 6. WHITELIST MODIFIER ───────────────────────────────────────────────────

describe('Whitelist Modifier', () => {
  it('allows 5× limit for whitelisted IP', async () => {
    setWhitelistedIdentity('ip:127.0.0.1');
    mockReflector.get.mockReturnValue('test');
    mockCounter.increment
      .mockResolvedValueOnce({ count: 1, remaining: 49, resetMs: 50000 })  // burst (5*5=25... wait, burst limit is 5, whitelisted → 25)
      .mockResolvedValueOnce({ count: 10, remaining: 40, resetMs: 50000 }); // main (10*5=50)

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    expect(allowed).toBe(true);
    // Effective limit passed to increment: 10 * 5 = 50
    expect(mockCounter.increment).toHaveBeenLastCalledWith(expect.any(String), 50, 60000);
  });

  it('does not affect non-whitelisted identities', async () => {
    mockReflector.get.mockReturnValue('test');
    mockCounter.increment
      .mockResolvedValueOnce({ count: 1, remaining: 4, resetMs: 50000 })  // burst (limit 5)
      .mockResolvedValueOnce({ count: 3, remaining: 7, resetMs: 50000 });  // main (limit 10)

    await guard.canActivate(makeCtx(makeReq({})));

    expect(mockCounter.increment).toHaveBeenLastCalledWith(expect.any(String), 10, 60000);
  });
});

// ─── 7. RISK SCORE ACCUMULATION ──────────────────────────────────────────────

describe('Risk Score Accumulation', () => {
  it('records violation when rate limited', async () => {
    mockReflector.get.mockReturnValue('test');
    mockCounter.increment
      .mockResolvedValueOnce({ count: 99, remaining: 0, resetMs: 30000 })
      .mockResolvedValueOnce({ count: 11, remaining: -1, resetMs: 30000 });

    const allowed = await guard.canActivate(makeCtx(makeReq({})));

    expect(allowed).toBe(false);
    expect(mockRiskScore.recordViolation).toHaveBeenCalledWith(
      'ip:127.0.0.1', '127.0.0.1', expect.any(Object), false,
    );
  });

  it('does not record violation when request is allowed', async () => {
    mockReflector.get.mockReturnValue('test');

    await guard.canActivate(makeCtx(makeReq({})));

    expect(mockRiskScore.recordViolation).not.toHaveBeenCalled();
  });
});

// ─── 8. POLICY RESOLUTION ────────────────────────────────────────────────────

describe('Policy Resolution', () => {
  it('uses method-level decorator when present', async () => {
    mockReflector.get.mockReturnValue('auth'); // handler-level decorator

    await guard.canActivate(makeCtx(makeReq({}, '/api/anything')));

    expect(mockPolicyStore.get).toHaveBeenCalledWith('auth');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'auth');
  });

  it('uses class-level decorator when no handler decorator', async () => {
    mockReflector.get
      .mockReturnValueOnce(undefined)   // no handler-level
      .mockReturnValueOnce('health');   // class-level

    await guard.canActivate(makeCtx(makeReq({}, '/api/anything')));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'health');
  });

  it('falls back to path-based resolution when no decorator', async () => {
    mockReflector.get
      .mockReturnValueOnce(undefined)  // no handler
      .mockReturnValueOnce(undefined); // no class

    await guard.canActivate(makeCtx(makeReq({}, '/api/auth/signup')));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'auth');
  });

  it('defaults to api for unknown paths', async () => {
    mockReflector.get
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    await guard.canActivate(makeCtx(makeReq({}, '/api/unknown/path')));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'api');
  });
});

// ─── 9. PREDEFINED ENDPOINT POLICIES ─────────────────────────────────────────

describe('Predefined Endpoint Policies', () => {
  async function testPolicy(path: string, expectedPolicy: string, expectedLimit: number) {
    mockReflector.get
      .mockReturnValueOnce(undefined)  // no handler
      .mockReturnValueOnce(undefined); // no class
    mockCounter.increment
      .mockResolvedValueOnce({ count: 1, remaining: 99, resetMs: 50000 })
      .mockResolvedValueOnce({ count: 1, remaining: 99, resetMs: 50000 });

    await guard.canActivate(makeCtx(makeReq({}, path)));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', expectedPolicy);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', String(expectedLimit));
  }

  it('health endpoint uses 100 limit per unknown tier', () => testPolicy('/api/health', 'health', 100));
  it('browser-check endpoint uses 100 limit', () => testPolicy('/api/rate-limit/browser-check', 'browser_check', 100));
  it('auth endpoint uses 10 limit per unknown tier', () => testPolicy('/api/auth/login', 'auth', 10));
  it('admin endpoint uses 10 limit per unknown tier', () => testPolicy('/api/admin/users', 'admin', 10));
  it('POS endpoint uses 10 limit per unknown tier', () => testPolicy('/api/pos/orders', 'pos', 10));
  it('webhook endpoint uses 10 limit per unknown tier', () => testPolicy('/api/webhook/stripe', 'webhooks', 10));

  it('payments fallback to checkout policy', async () => {
    mockReflector.get
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    await guard.canActivate(makeCtx(makeReq({}, '/api/payments/123')));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'checkout');
  });

  it('bkash fallback to checkout policy', async () => {
    mockReflector.get
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    await guard.canActivate(makeCtx(makeReq({}, '/api/bkash/callback')));

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Policy', 'checkout');
  });
});

// ─── 10. COUNTER KEY ISOLATION ───────────────────────────────────────────────

describe('Counter Key Isolation', () => {
  it('uses identity-based key for identity tracking policy', async () => {
    mockTierService.determine.mockReturnValue({ tier: TrustTier.AUTHENTICATED, identity: 'user:abc' });
    mockReflector.get.mockReturnValue('test');
    mockCounter.buildKey.mockImplementation((t, p, t2, id) => `${t}:${p}:${t2}:${id}`);

    await guard.canActivate(makeCtx(makeReq({})));

    expect(mockCounter.buildKey).toHaveBeenCalledWith('default', 'test', 'authenticated', 'user:abc');
  });

  it('uses ip-based key for IP tracking', async () => {
    mockReflector.get.mockReturnValue('test');
    mockPolicyStore.get.mockImplementation((name?: string) => ({
      ...policyFor(name || 'test'),
      trackingKey: 'ip',
    }));
    mockTierService.extractIp.mockReturnValue('5.6.7.8');

    await guard.canActivate(makeCtx(makeReq({})));

    expect(mockCounter.buildKey).toHaveBeenCalledWith('default', 'test', 'unknown', 'ip:5.6.7.8');
  });
});
