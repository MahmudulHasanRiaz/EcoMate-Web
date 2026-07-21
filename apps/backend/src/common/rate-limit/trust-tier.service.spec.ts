import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TrustTierService } from './trust-tier.service';
import { TrustTier } from './trust-tier.enum';
import type { FastifyRequest } from 'fastify';

const SECRET = 'test-ratelimit-secret-0123456789';

function makeReq(cookies?: Record<string, string>, ip?: string): FastifyRequest {
  return {
    cookies: cookies || {},
    headers: { 'x-forwarded-for': ip || '203.0.113.1' },
    ip: '192.168.1.1',
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as FastifyRequest;
}

function makeAuthReq(userId: string): FastifyRequest {
  return {
    cookies: {},
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    user: { id: userId },
  } as unknown as FastifyRequest;
}

let service: TrustTierService;

beforeEach(async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TrustTierService,
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(SECRET) } },
    ],
  }).compile();
  service = module.get<TrustTierService>(TrustTierService);
});

// ─── TIER RESOLUTION ─────────────────────────────────────────────────────────

describe('Tier Resolution', () => {
  it('returns UNKNOWN when no cookies or auth', () => {
    const result = service.determine(makeReq({}));
    expect(result.tier).toBe(TrustTier.UNKNOWN);
    expect(result.identity).toMatch(/^ip:/);
  });

  it('returns BROWSER_TRUST with valid _rm_bt cookie', () => {
    const token = service.createBrowserTrustToken();
    const result = service.determine(makeReq({ _rm_bt: token }));
    expect(result.tier).toBe(TrustTier.BROWSER_TRUST);
    expect(result.identity).toMatch(/^bt:/);
  });

  it('returns SESSION with valid _rm_sess cookie', () => {
    const { value } = service.createSessionCookieValue();
    const result = service.determine(makeReq({ _rm_sess: value }));
    expect(result.tier).toBe(TrustTier.SESSION);
    expect(result.identity).toMatch(/^sess:/);
  });

  it('returns AUTHENTICATED when user object present', () => {
    const result = service.determine(makeAuthReq('user-abc'));
    expect(result.tier).toBe(TrustTier.AUTHENTICATED);
    expect(result.identity).toMatch(/^user:/);
  });

  it('AUTHENTICATED takes priority over cookies', () => {
    const token = service.createBrowserTrustToken();
    const req = makeAuthReq('user-abc');
    req.cookies = { _rm_bt: token };
    const result = service.determine(req);
    expect(result.tier).toBe(TrustTier.AUTHENTICATED);
  });

  it('extracts user from request.user.userId', () => {
    const req = makeReq();
    (req as any).user = { userId: 'test-uid' };
    const result = service.determine(req);
    expect(result.tier).toBe(TrustTier.AUTHENTICATED);
    expect(result.identity).toBe('user:test-uid');
  });

  it('extracts user from request.user.sub', () => {
    const req = makeReq();
    (req as any).user = { sub: 'sub-uid' };
    const result = service.determine(req);
    expect(result.tier).toBe(TrustTier.AUTHENTICATED);
    expect(result.identity).toBe('user:sub-uid');
  });
});

// ─── BROWSER TRUST COOKIE ────────────────────────────────────────────────────

describe('Browser Trust Cookie (_rm_bt)', () => {
  it('creates valid 3-part HMAC token', () => {
    const token = service.createBrowserTrustToken();
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-z]+$/); // base36 timestamp
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url nonce
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url HMAC
  });

  it('verifies own browser trust cookie', () => {
    const token = service.createBrowserTrustToken();
    const nonce = service.verifyBrowserTrustCookie(makeReq({ _rm_bt: token }));
    expect(nonce).toBeTruthy();
  });

  it('rejects tampered cookie', () => {
    const token = service.createBrowserTrustToken();
    const [ts, nonce] = token.split('.');
    const tampered = `${ts}.${nonce}.invalidsignature`;
    const result = service.verifyBrowserTrustCookie(makeReq({ _rm_bt: tampered }));
    expect(result).toBeNull();
  });

  it('rejects expired browser trust cookie (>24h)', () => {
    // Create a token with a timestamp 25h in the past
    const oldTs = Math.floor((Date.now() - 25 * 3600 * 1000) / 1000).toString(36);
    const nonce = 'dGVzdC1ub25jZQ';
    const hmac = require('crypto')
      .createHmac('sha256', SECRET)
      .update(`${oldTs}.${nonce}`)
      .digest('base64url');
    const oldToken = `${oldTs}.${nonce}.${hmac}`;

    const result = service.verifyBrowserTrustCookie(makeReq({ _rm_bt: oldToken }));
    expect(result).toBeNull();
  });

  it('rejects malformed cookie (wrong part count)', () => {
    const result = service.verifyBrowserTrustCookie(makeReq({ _rm_bt: 'only.two' }));
    expect(result).toBeNull();
  });
});

// ─── SESSION COOKIE ──────────────────────────────────────────────────────────

describe('Session Cookie (_rm_sess)', () => {
  it('creates valid 3-part HMAC value', () => {
    const { value } = service.createSessionCookieValue();
    const parts = value.split('.');
    expect(parts).toHaveLength(3);
  });

  it('verifies own session cookie', () => {
    const { value } = service.createSessionCookieValue();
    const sid = service.determine(makeReq({ _rm_sess: value }));
    expect(sid.tier).toBe(TrustTier.SESSION);
  });

  it('rejects expired session cookie (>24h)', () => {
    const oldTs = Math.floor((Date.now() - 25 * 3600 * 1000) / 1000).toString(36);
    const sid = 'dGVzdC1zZXNzaW9u';
    const hmac = require('crypto')
      .createHmac('sha256', SECRET)
      .update(`${oldTs}.${sid}`)
      .digest('base64url');
    const oldValue = `${oldTs}.${sid}.${hmac}`;

    const result = service.verifySessionCookie(makeReq({ _rm_sess: oldValue }));
    expect(result).toBeNull();
  });

  it('rejects tampered session cookie', () => {
    const { value } = service.createSessionCookieValue();
    const tampered = value.replace(/[A-Za-z0-9_-]{10}$/, 'tamperedval');
    const result = service.verifySessionCookie(makeReq({ _rm_sess: tampered }));
    expect(result).toBeNull();
  });
});

// ─── IP EXTRACTION ───────────────────────────────────────────────────────────

describe('IP Extraction', () => {
  it('prefers X-Forwarded-For', () => {
    const ip = service.extractIp(makeReq({}, '203.0.113.50'));
    expect(ip).toBe('203.0.113.50');
  });

  it('falls back to request.ip when no X-Forwarded-For', () => {
    const req = makeReq({});
    delete (req as any).headers['x-forwarded-for'];
    const ip = service.extractIp(req);
    expect(ip).toBe('192.168.1.1');
  });

  it('uses first IP from X-Forwarded-For chain', () => {
    const req = makeReq({}, '1.2.3.4, 5.6.7.8, 9.10.11.12');
    const ip = service.extractIp(req);
    expect(ip).toBe('1.2.3.4');
  });
});
