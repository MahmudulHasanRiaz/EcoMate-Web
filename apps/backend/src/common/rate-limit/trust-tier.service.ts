import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { FastifyRequest } from 'fastify';
import { TrustTier } from './trust-tier.enum';

export interface TrustResult {
  tier: TrustTier;
  identity: string;
}

@Injectable()
export class TrustTierService {
  private readonly logger = new Logger(TrustTierService.name);
  private readonly cookieSecret: string;

  constructor(private readonly config: ConfigService) {
    this.cookieSecret = this.config.get<string>('RATE_LIMIT_COOKIE_SECRET')
      || 'dev-ratelimit-cookie-secret-change-in-production';
  }

  /**
   * FUTURE ROTATION EXTENSION POINTS
   *
   * 1. Near-expiry silent refresh:
   *    In determine(), after verifyBrowserTrustCookie() succeeds, check
   *    tsB36 age. If remaining TTL < 2h (ageMs > 7200000), generate a new
   *    token and attach it to the response so the next page load picks it up.
   *    Store the old token in a short-lived allow-list so inflight requests
   *    using it don't drop to UNKNOWN mid-page.
   *
   * 2. Login/logout regeneration:
   *    Call invalidateBrowserTrust(sessionId) from the auth controller after
   *    login/logout. Add an in-memory set of invalidated nonces (with a 25h
   *    TTL) and check it in verifyBrowserTrustCookie().
   *
   * 3. Suspicious activity invalidation:
   *    After risk-score threshold or anomaly detection, the RiskScoreService
   *    or BlockedEntriesService calls invalidateBrowserTrust(identity) to
   *    force the offending client back to UNKNOWN, resetting their effective
   *    limit to the lowest tier.
   *
   * Each hook is optional — current 24h rotation is acceptable for launch.
   */

  determine(request: FastifyRequest): TrustResult {
    const userId = this.extractUserId(request);
    if (userId) {
      return { tier: TrustTier.AUTHENTICATED, identity: `user:${userId}` };
    }

    const sessionId = this.verifySessionCookie(request);
    if (sessionId) {
      return { tier: TrustTier.SESSION, identity: `sess:${sessionId}` };
    }

    const btNonce = this.verifyBrowserTrustCookie(request);
    if (btNonce) {
      return { tier: TrustTier.BROWSER_TRUST, identity: `bt:${btNonce}` };
    }

    return { tier: TrustTier.UNKNOWN, identity: `ip:${this.extractIp(request)}` };
  }

  extractIp(request: FastifyRequest): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim();
      if (first && first !== 'unknown') return first;
    }
    return request.ip || request.socket.remoteAddress || '0.0.0.0';
  }

  private extractUserId(request: FastifyRequest): string | null {
    try {
      const user = (request as any).user;
      if (user?.id) return user.id;
      if (user?.userId) return user.userId;
      if (user?.sub) return user.sub;
      return null;
    } catch {
      return null;
    }
  }

  private verifySessionCookie(request: FastifyRequest): string | null {
    try {
      const cookie = request.cookies?.['_rm_sess'];
      if (!cookie) return null;

      const parts = cookie.split('.');
      if (parts.length !== 3) return null;

      const [tsB36, sid, hmac] = parts;
      const ageMs = Date.now() - parseInt(tsB36, 36) * 1000;
      if (ageMs > 86400000 || ageMs < 0) return null;

      const expected = crypto
        .createHmac('sha256', this.cookieSecret)
        .update(`${tsB36}.${sid}`)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
        return null;
      }

      return sid;
    } catch {
      return null;
    }
  }

  verifyBrowserTrustCookie(request: FastifyRequest): string | null {
    try {
      const cookie = request.cookies?.['_rm_bt'];
      if (!cookie) return null;

      const parts = cookie.split('.');
      if (parts.length !== 3) return null;

      const [tsB36, nonce, hmac] = parts;
      const ageMs = Date.now() - parseInt(tsB36, 36) * 1000;
      if (ageMs > 86400000 || ageMs < 0) return null;

      const expected = crypto
        .createHmac('sha256', this.cookieSecret)
        .update(`${tsB36}.${nonce}`)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
        return null;
      }

      return nonce;
    } catch {
      return null;
    }
  }

  createSessionCookieValue(): { value: string; id: string } {
    const timestamp = Math.floor(Date.now() / 1000).toString(36);
    const sessionId = crypto.randomBytes(12).toString('base64url');
    const hmac = crypto
      .createHmac('sha256', this.cookieSecret)
      .update(`${timestamp}.${sessionId}`)
      .digest('base64url');
    return { value: `${timestamp}.${sessionId}.${hmac}`, id: sessionId };
  }

  createBrowserTrustToken(): string {
    const timestamp = Math.floor(Date.now() / 1000).toString(36);
    const nonce = crypto.randomBytes(12).toString('base64url');
    const hmac = crypto
      .createHmac('sha256', this.cookieSecret)
      .update(`${timestamp}.${nonce}`)
      .digest('base64url');
    return `${timestamp}.${nonce}.${hmac}`;
  }
}
