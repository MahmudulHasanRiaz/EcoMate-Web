import * as crypto from 'crypto';
import type { FastifyRequest } from 'fastify';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/**
 * F1 + F2 (owner decisions, avelto incident follow-ups — implemented
 * together because each half is unsafe alone):
 *
 * F2 — internal service-to-service calls carry a shared-secret header
 * (`x-internal-secret`, env INTERNAL_SHARED_SECRET on both sides).
 * F1 — requests from private-range IPs are exempt from rate limiting.
 *
 * The exemption requires BOTH factors:
 *  - the header matches the configured secret (timing-safe compare), AND
 *  - the TCP peer (socket.remoteAddress — NEVER x-forwarded-for, which is
 *    client-controlled under trustProxy and would let anyone on the
 *    internet spoof "internal" with one header) is a private / loopback /
 *    link-local address.
 *
 * With INTERNAL_SHARED_SECRET unset the feature is OFF: no request is
 * internal, nothing changes. The secret alone is the credential; the
 * private-peer requirement is defense in depth so a leaked secret cannot
 * be replayed from the open internet.
 */
export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  let v = ip.trim().toLowerCase();
  if (v.startsWith('::ffff:')) v = v.slice(7);
  if (v === '::1' || v === 'localhost') return true;
  // IPv6 link-local fe80::/10 and unique-local fc00::/7.
  if (v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

export function isInternalRequest(request: FastifyRequest): boolean {
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!secret) return false;
  const header = request.headers[INTERNAL_SECRET_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const peer =
    request.socket?.remoteAddress ||
    (request as any).raw?.socket?.remoteAddress;
  return isPrivateIp(peer);
}
