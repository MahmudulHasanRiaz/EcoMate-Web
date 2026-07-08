import { createHmac, timingSafeEqual } from 'crypto';
import type { LicensePayload } from './types';

const BASE64_URL = /^[A-Za-z0-9_-]+$/;

function base64UrlDecode(s: string): string {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

export function signToken(payload: Omit<LicensePayload, 'iat'>, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string, secret?: string): { valid: boolean; payload?: LicensePayload; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'empty_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed' };
  }
  const [headerB64, payloadB64, sigB64] = parts;
  if (!BASE64_URL.test(headerB64) || !BASE64_URL.test(payloadB64) || !BASE64_URL.test(sigB64)) {
    return { valid: false, reason: 'invalid_encoding' };
  }
  if (secret) {
    const expectedSig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
    const actualSig = Buffer.from(sigB64, 'base64url');
    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      return { valid: false, reason: 'bad_signature' };
    }
  }
  let payload: LicensePayload;
  try {
    const decoded = base64UrlDecode(payloadB64);
    payload = JSON.parse(decoded);
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }
  if (!payload.clientId || !payload.plan || !Array.isArray(payload.features)) {
    return { valid: false, reason: 'invalid_payload' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}
