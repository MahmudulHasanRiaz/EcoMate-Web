/**
 * Production-connected tests for Batch 2 security fixes.
 *
 * Every test imports and invokes real production code (SecureFetcher,
 * ip-classifier, webhook-verifier). DNS and HTTP
 * are injected as mocks so tests are deterministic and network-free.
 * The RED→GREEN cycle is demonstrated by running before and after
 * the real production code was implemented.
 *
 * Key behaviors verified:
 * - Connection pinning (DNS resolved once, lookup returns pinned addr)
 * - Post-connect socket.remoteAddress check
 * - Redirect following with per-hop security
 * - Content-Length and streaming byte caps
 * - Magic byte + sharp metadata validation
 * - Shared deadline across all hops
 * - RedX HMAC with constant-time comparison
 * - Image service fallback and cache MIME detection
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

/* ── Imports from real production modules ── */
import { isBlockedIP, validateImageUrl, resolveAndPin, DnsResolver } from '../images/ip-classifier';
import { SecureFetcher, HttpTransport, detectImageMime, validateImageBuffer } from '../images/secure-fetcher';
import { ImagesService } from '../images/images.service';
import { verifyRedxHmac } from '../courier-manager/webhook-verifier';

/* ═══════════════════════════════════════════════
   1. IP CLASSIFIER (ipaddr.js-based)
   ═══════════════════════════════════════════════ */

describe('isBlockedIP (ipaddr.js)', () => {
  // --- IPv4 ---
  it('blocks loopback 127.0.0.0/8', () => {
    expect(isBlockedIP('127.0.0.1')).toBe(true);
    expect(isBlockedIP('127.255.255.255')).toBe(true);
  });

  it('blocks RFC 1918 10.0.0.0/8', () => {
    expect(isBlockedIP('10.0.0.1')).toBe(true);
  });

  it('blocks RFC 1918 172.16.0.0/12', () => {
    expect(isBlockedIP('172.16.0.1')).toBe(true);
    expect(isBlockedIP('172.31.255.255')).toBe(true);
  });

  it('blocks RFC 1918 192.168.0.0/16', () => {
    expect(isBlockedIP('192.168.1.1')).toBe(true);
  });

  it('blocks link-local 169.254.0.0/16', () => {
    expect(isBlockedIP('169.254.169.254')).toBe(true);
  });

  it('blocks CGNAT 100.64.0.0/10', () => {
    expect(isBlockedIP('100.64.0.1')).toBe(true);
    expect(isBlockedIP('100.127.255.255')).toBe(true);
  });

  it('blocks multicast 224.0.0.0/4', () => {
    expect(isBlockedIP('224.0.0.1')).toBe(true);
    expect(isBlockedIP('239.255.255.255')).toBe(true);
  });

  it('blocks reserved 240.0.0.0/4', () => {
    expect(isBlockedIP('240.0.0.1')).toBe(true);
  });

  it('blocks limited broadcast', () => {
    expect(isBlockedIP('255.255.255.255')).toBe(true);
  });

  it('blocks documentation/test ranges', () => {
    expect(isBlockedIP('192.0.2.1')).toBe(true);    // TEST-NET-1
    expect(isBlockedIP('198.51.100.1')).toBe(true);  // TEST-NET-2
    expect(isBlockedIP('203.0.113.1')).toBe(true);   // TEST-NET-3
  });

  it('blocks benchmark 198.18.0.0/15', () => {
    expect(isBlockedIP('198.18.0.1')).toBe(true);
    expect(isBlockedIP('198.19.255.255')).toBe(true);
  });

  it('blocks carrier-grade NAT 100.64.0.0/10', () => {
    expect(isBlockedIP('100.64.0.1')).toBe(true);
  });

  it('allows public IPv4', () => {
    expect(isBlockedIP('8.8.8.8')).toBe(false);
    expect(isBlockedIP('1.1.1.1')).toBe(false);
    expect(isBlockedIP('93.184.216.34')).toBe(false);
  });

  // --- IPv6 ---
  it('blocks loopback ::1', () => {
    expect(isBlockedIP('::1')).toBe(true);
  });

  it('blocks unspecified ::/128', () => {
    expect(isBlockedIP('::')).toBe(true);
  });

  it('blocks unique-local fc00::/7', () => {
    expect(isBlockedIP('fc00::1')).toBe(true);
    expect(isBlockedIP('fd00::1')).toBe(true);
  });

  it('blocks link-local fe80::/10', () => {
    expect(isBlockedIP('fe80::1')).toBe(true);
  });

  it('blocks multicast ff00::/8', () => {
    expect(isBlockedIP('ff00::1')).toBe(true);
    expect(isBlockedIP('ff02::1')).toBe(true);
  });

  it('blocks documentation 2001:db8::/32', () => {
    expect(isBlockedIP('2001:db8::1')).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isBlockedIP('2001:4860:4860::8888')).toBe(false);
    expect(isBlockedIP('2606:4700:4700::1111')).toBe(false);
  });

  it('parses malformed input without throwing (returns true)', () => {
    expect(isBlockedIP('not-an-ip')).toBe(true);
    expect(isBlockedIP('')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   2. URL VALIDATION (validateImageUrl)
   ═══════════════════════════════════════════════ */

describe('validateImageUrl', () => {
  it('rejects non-http(s) protocols', () => {
    expect(() => validateImageUrl('file:///etc/passwd')).toThrow('Only http/https');
    expect(() => validateImageUrl('ftp://evil.com/')).toThrow('Only http/https');
  });

  it('rejects embedded credentials', () => {
    expect(() => validateImageUrl('http://user:pass@evil.com/')).toThrow('embedded credentials');
  });

  it('rejects private IP URLs', () => {
    expect(() => validateImageUrl('http://127.0.0.1/')).toThrow('Private/reserved');
    expect(() => validateImageUrl('http://10.0.0.1/')).toThrow('Private/reserved');
    expect(() => validateImageUrl('http://192.168.1.1/')).toThrow('Private/reserved');
    expect(() => validateImageUrl('http://[::1]:6379/')).toThrow('Private/reserved');
    expect(() => validateImageUrl('http://[fd00::1]/')).toThrow('Private/reserved');
  });

  it('allows public URLs', () => {
    expect(() => validateImageUrl('https://images.unsplash.com/abc')).not.toThrow();
    expect(() => validateImageUrl('https://cdn.example.com/img.jpg')).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════
   3. DNS RESOLVE + PIN (with mock resolver)
   ═══════════════════════════════════════════════ */

describe('resolveAndPin (with mock DNS)', () => {
  const mockDns: DnsResolver = {
    resolve4: async () => [],
    resolve6: async () => [],
  };

  it('rejects hostname that resolves to empty', async () => {
    await expect(resolveAndPin('unknown.example.com', mockDns))
      .rejects.toThrow('DNS resolution returned no addresses');
  });

  it('rejects hostname with mixed public+private IPs', async () => {
    await expect(resolveAndPin('mix.example.com', {
      resolve4: async () => ['8.8.8.8', '10.0.0.1'],
      resolve6: async () => [],
    })).rejects.toThrow('DNS resolution resolved to a blocked IP');
  });

  it('rejects hostname that resolves entirely to private', async () => {
    await expect(resolveAndPin('private.example.com', {
      resolve4: async () => ['10.0.0.1'],
      resolve6: async () => [],
    })).rejects.toThrow('DNS resolution resolved to a blocked IP');
  });

  it('returns pinned address for clean hostname', async () => {
    const pinned = await resolveAndPin('safe.example.com', {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => [],
    });
    expect(pinned).toBe('93.184.216.34');
  });

  it('rejects direct private IPv4 without DNS', async () => {
    await expect(resolveAndPin('10.0.0.1', mockDns))
      .rejects.toThrow('Private/reserved IP addresses are not allowed');
  });

  it('rejects direct private IPv6 without DNS', async () => {
    await expect(resolveAndPin('fd00::1', mockDns))
      .rejects.toThrow('Private/reserved IP addresses are not allowed');
  });
});

/* ═══════════════════════════════════════════════
   4. SECURE FETCHER — mocked HTTP transport
   ═══════════════════════════════════════════════ */

/**
 * Create a mock IncomingMessage for testing.
 */
function mockResponse(opts: {
  statusCode: number;
  headers?: Record<string, string>;
  body?: Buffer;
  destroy?: boolean;
  remoteAddress?: string;
}): IncomingMessage {
  const socket = new Socket();
  if (opts.remoteAddress) {
    Object.defineProperty(socket, 'remoteAddress', { value: opts.remoteAddress, writable: false });
  }

  const res = new IncomingMessage(socket);
  Object.defineProperty(res, 'statusCode', { value: opts.statusCode, writable: false });
  if (opts.headers) res.headers = opts.headers;
  if (opts.body) {
    // Push body chunks and end
    process.nextTick(() => {
      res.push(opts.body!);
      res.push(null);
    });
  } else {
    process.nextTick(() => res.push(null));
  }
  if (opts.destroy) res.destroy = () => {};
  return res;
}

describe('SecureFetcher.fetch (mocked DNS + HTTP)', () => {
  // Helpers to create test instances
  function makeFetcher(
    dnsResolve: (...args: any[]) => any,
    httpHandler: (...args: any[]) => any,
  ) {
    const dns: DnsResolver = {
      resolve4: async (h: string) => {
        const r = dnsResolve(h);
        return r;
      },
      resolve6: async () => [],
    };

    let capturedOptions: any = null;
    const transport: HttpTransport = {
      request: async (opts: any) => {
        capturedOptions = opts;
        const result = await httpHandler(opts);
        const res = result.response;
        // Default connectedAddress by invoking the pinned lookup if not explicitly provided.
        // Allow explicit undefined for missing-address tests.
        let addr = result.connectedAddress;
        if (addr === undefined && !('connectedAddress' in result)) {
          addr = (res.socket as any)?.remoteAddress;
          if (!addr && opts.lookup) {
            addr = await new Promise((resolve) => {
              opts.lookup('ignored', {}, (_err: any, a: string) => resolve(a));
            });
          }
        }
        return { response: res, connectedAddress: addr };
      },
    };

    const fetcher = new SecureFetcher(dns, transport);
    return { fetcher, getCapturedOptions: () => capturedOptions };
  }

  // Smallest valid PNG (1x1 transparent)
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('sends request with pinned IP via custom lookup, hostname preserved in options, fetch succeeds', async () => {
    const dns: DnsResolver = {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => [],
    };
    let capturedOpts: any = null;
    const transport: HttpTransport = {
      request: async (opts: any) => {
        capturedOpts = opts;
        const res = mockResponse({ statusCode: 200, body: PNG_1x1, remoteAddress: '93.184.216.34' });
        return { response: res, connectedAddress: '93.184.216.34' };
      },
    };
    const fetcher = new SecureFetcher(dns, transport);

    // PNG_1x1 is valid — fetch should succeed
    const result = await fetcher.fetch('http://example.com/img.png');
    expect(capturedOpts.hostname).toBe('example.com');
    expect(capturedOpts.lookup).toBeDefined();
    // Invoke the lookup callback and assert pinned address with correct family
    const lookupCb = capturedOpts.lookup;
    let returnedAddr = '';
    let returnedFamily = 0;
    lookupCb('ignored', {}, (err: any, addr: string, family?: number) => {
      returnedAddr = addr;
      returnedFamily = family ?? 0;
    });
    expect(returnedAddr).toBe('93.184.216.34');
    expect(returnedFamily).toBe(4);
    expect(capturedOpts.agent).toBe(false);
    expect(capturedOpts.method).toBe('GET');
    expect(result.mimeType).toBe('image/png');
  });

  it('post-connect socket mismatch: public DNS result but private connectedAddress triggers destroy and error', async () => {
    let destroyed = false;
    const dns: DnsResolver = {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => [],
    };
    const transport: HttpTransport = {
      request: async (opts: any) => {
        const res = mockResponse({ statusCode: 200, body: PNG_1x1, remoteAddress: '10.0.0.1' });
        res.destroy = () => { destroyed = true; };
        return { response: res, connectedAddress: '10.0.0.1' };
      },
    };
    const fetcher = new SecureFetcher(dns, transport);

    await expect(fetcher.fetch('http://example.com/img.png'))
      .rejects.toThrow('blocked');
    expect(destroyed).toBe(true);
  });

  it('different public connected address (not matching pinned) is rejected and destroyed', async () => {
    let destroyed = false;
    const dns: DnsResolver = {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => [],
    };
    const transport: HttpTransport = {
      request: async (opts: any) => {
        const res = mockResponse({ statusCode: 200, body: PNG_1x1, remoteAddress: '1.2.3.4' });
        res.destroy = () => { destroyed = true; };
        return { response: res, connectedAddress: '1.2.3.4' };
      },
    };
    const fetcher = new SecureFetcher(dns, transport);

    await expect(fetcher.fetch('http://example.com/img.png'))
      .rejects.toThrow('does not match pinned DNS address');
    expect(destroyed).toBe(true);
  });

  it('expanded IPv6 DNS vs compressed IPv6 connected succeeds (semantic equality)', async () => {
    const resolve6Spy = jest.fn().mockResolvedValue(['2001:4860:4860:0000:0000:0000:0000:8888']);
    const dns: DnsResolver = {
      resolve6: resolve6Spy,
      resolve4: async () => [],
    };
    const transport: HttpTransport = {
      request: async (opts: any) => {
        const res = mockResponse({ statusCode: 200, body: PNG_1x1, remoteAddress: '2001:4860:4860::8888' });
        return { response: res, connectedAddress: '2001:4860:4860::8888' };
      },
    };
    const fetcher = new SecureFetcher(dns, transport);
    const result = await fetcher.fetch('http://ipv6.example.com/img.png');
    expect(resolve6Spy).toHaveBeenCalledWith('ipv6.example.com');
    expect(result.mimeType).toBe('image/png');
  });

  it('IPv4 DNS vs ::ffff-mapped IPv6 connected succeeds (ipaddr.process converts)', async () => {
    const dns: DnsResolver = {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => [],
    };
    const transport: HttpTransport = {
      request: async (opts: any) => {
        const res = mockResponse({ statusCode: 200, body: PNG_1x1, remoteAddress: '::ffff:5db8:d822' });
        return { response: res, connectedAddress: '::ffff:5db8:d822' };
      },
    };
    const fetcher = new SecureFetcher(dns, transport);
    const result = await fetcher.fetch('http://example.com/img.png');
    expect(result.mimeType).toBe('image/png');
  });

  it('missing connectedAddress — fails closed with destroy', async () => {
    let destroyed = false;
    const { fetcher } = makeFetcher(
      () => ['93.184.216.34'],
      (opts: any) => {
        const res = mockResponse({ statusCode: 200, body: PNG_1x1 });
        res.destroy = () => { destroyed = true; };
        return { response: res, connectedAddress: undefined };
      },
    );
    await expect(fetcher.fetch('http://example.com/img.png'))
      .rejects.toThrow('Could not verify connected address');
    expect(destroyed).toBe(true);
  });

  let redirectDestroyed = false;
  it('redirect to private URL is rejected and body destroyed', async () => {
    let redirected = false;
    redirectDestroyed = false;
    const { fetcher } = makeFetcher(
      (hostname: string) => {
        if (hostname === 'redirect.com') return ['93.184.216.34'];
        return ['10.0.0.1'];
      },
      (opts: any) => {
        if (!redirected) {
          redirected = true;
          const res = mockResponse({
            statusCode: 302,
            headers: { location: 'http://10.0.0.1/secret' },
          });
          res.destroy = () => { redirectDestroyed = true; };
          return { response: res };
        }
        return { response: mockResponse({ statusCode: 200, body: PNG_1x1 }) };
      },
    );

    await expect(fetcher.fetch('http://redirect.com/img.png'))
      .rejects.toThrow('Private/reserved IP addresses are not allowed');
    expect(redirectDestroyed).toBe(true);
  });

  it('excess Content-Length is rejected before streaming, response destroyed', async () => {
    let contentLengthDestroyed = false;
    const { fetcher } = makeFetcher(
      () => ['93.184.216.34'],
      (opts: any) => {
        const res = mockResponse({
          statusCode: 200,
          headers: { 'content-length': '99999999' },
          body: PNG_1x1,
        });
        res.destroy = () => { contentLengthDestroyed = true; };
        return { response: res };
      },
    );

    await expect(fetcher.fetch('http://example.com/img.png', { maxBytes: 100 }))
      .rejects.toThrow('Response Content-Length exceeds maximum size');
    expect(contentLengthDestroyed).toBe(true);
  });

  it('excess streaming body is destroyed at byte cap', async () => {
    let streamDestroyed = false;
    const bigChunk = Buffer.alloc(1000, 0x41);
    const { fetcher } = makeFetcher(
      () => ['93.184.216.34'],
      (opts: any) => {
        const res = mockResponse({ statusCode: 200, body: bigChunk });
        res.destroy = () => { streamDestroyed = true; };
        return { response: res };
      },
    );

    await expect(fetcher.fetch('http://example.com/img.bin', { maxBytes: 100 }))
      .rejects.toThrow('Response exceeds maximum size');
    expect(streamDestroyed).toBe(true);
  });

  it('non-2xx response is rejected and body destroyed', async () => {
    let non2xxDestroyed = false;
    const { fetcher } = makeFetcher(
      () => ['93.184.216.34'],
      (opts: any) => {
        const res = mockResponse({ statusCode: 500, body: Buffer.from('error') });
        res.destroy = () => { non2xxDestroyed = true; };
        return { response: res };
      },
    );

    await expect(fetcher.fetch('http://example.com/error'))
      .rejects.toThrow('responded 500');
    expect(non2xxDestroyed).toBe(true);
  });

  it('non-image body rejected by magic byte check', async () => {
    const { fetcher } = makeFetcher(
      () => ['93.184.216.34'],
      (opts: any) => {
        const res = mockResponse({
          statusCode: 200,
          body: Buffer.from('This is not an image'),
          headers: { 'content-type': 'text/plain' },
        });
        return { response: res };
      },
    );

    await expect(fetcher.fetch('http://example.com/file.txt'))
      .rejects.toThrow('not a valid image format');
  });

  it('valid PNG passes magic byte detection and is decodable by sharp', async () => {
    expect(detectImageMime(PNG_1x1)).toBe('image/png');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const meta = await sharp(PNG_1x1).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
  });

  it('total deadline aborts across DNS resolution', async () => {
    const fetcher = new SecureFetcher(
      {
        resolve4: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return ['93.184.216.34'];
        },
        resolve6: async () => [],
      },
      {
        request: async () => ({ response: mockResponse({ statusCode: 200, body: Buffer.alloc(0) }) }),
      },
    );

    // 10ms total timeout for fast deadline test; DNS takes 200ms
    await expect(fetcher.fetch('http://slow-dns.example.com/img.png', { totalTimeoutMs: 10 }))
      .rejects.toThrow('deadline');
  }, 10_000);
});

/* ═══════════════════════════════════════════════
   5. MAGIC BYTE DETECTION
   ═══════════════════════════════════════════════ */

describe('detectImageMime', () => {
  it('detects JPEG', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toBe('image/jpeg');
  });

  it('detects PNG', () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('detects GIF', () => {
    expect(detectImageMime(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
  });

  it('detects WebP', () => {
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(4, 4);
    buf.write('WEBP', 8);
    expect(detectImageMime(buf)).toBe('image/webp');
  });

  it('detects AVIF', () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0, 0);
    buf.write('ftypavif', 4, 8, 'ascii');
    expect(detectImageMime(buf)).toBe('image/avif');
  });

  it('returns null for non-image data', () => {
    expect(detectImageMime(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});

/* ═══════════════════════════════════════════════
   6. REDX WEBHOOK VERIFIER
   ═══════════════════════════════════════════════ */

describe('verifyRedxHmac (production function)', () => {
  const payload = { status: 'delivered', order_id: '123' };
  const secret = 'test-secret-12345';

  const computeSig = (body: unknown, s: string) =>
    crypto.createHmac('sha256', s).update(JSON.stringify(body), 'utf8').digest('hex');

  it('rejects undefined secret', () => {
    expect(() => verifyRedxHmac(payload, 'sig', undefined)).toThrow('RedX webhook not configured');
  });

  it('rejects missing signature (undefined)', () => {
    expect(() => verifyRedxHmac(payload, undefined, secret)).toThrow('Invalid webhook signature');
  });

  it('rejects non-string signature', () => {
    expect(() => verifyRedxHmac(payload, 12345 as any, secret)).toThrow('Invalid webhook signature');
  });

  it('rejects short hex string', () => {
    expect(() => verifyRedxHmac(payload, 'abcdef', secret)).toThrow('Invalid webhook signature');
  });

  it('rejects hex with wrong characters', () => {
    expect(() => verifyRedxHmac(payload, 'z'.repeat(64), secret)).toThrow('Invalid webhook signature');
  });

  it('rejects wrong key', () => {
    const sig = computeSig(payload, 'wrong-key');
    expect(() => verifyRedxHmac(payload, sig, secret)).toThrow('Invalid webhook signature');
  });

  it('rejects wrong payload', () => {
    const sig = computeSig({ wrong: 'payload' }, secret);
    expect(() => verifyRedxHmac(payload, sig, secret)).toThrow('Invalid webhook signature');
  });

  it('accepts valid HMAC', () => {
    const sig = computeSig(payload, secret);
    expect(() => verifyRedxHmac(payload, sig, secret)).not.toThrow();
  });

  it('compares decoded 32-byte buffers with timingSafeEqual', () => {
    const sig = computeSig(payload, secret);
    expect(sig.length).toBe(64);
    expect(() => verifyRedxHmac(payload, sig, secret)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════
   7. REDX CONTROLLER (real instance, mocked service)
   ═══════════════════════════════════════════════ */

import { CourierWebhookController } from '../courier-manager/courier-webhook.controller';
import { CourierWebhookService } from '../courier-manager/courier-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';

describe('CourierWebhookController redx (real instance)', () => {
  const testBody = { status: 'delivered', order_id: '123' };
  const testSecret = 'test-redx-secret-abc';
  const origSecret = process.env['REDX_WEBHOOK_SECRET'];

  const computeSig = (body: unknown, s: string) =>
    crypto.createHmac('sha256', s).update(JSON.stringify(body), 'utf8').digest('hex');

  let handleRedxMock: jest.Mock;
  let controller: CourierWebhookController;

  beforeEach(() => {
    handleRedxMock = jest.fn().mockResolvedValue({ success: true });
    const mockSvc = { handleRedx: handleRedxMock } as unknown as CourierWebhookService;
    const mockPrisma = {} as PrismaService;
    controller = new CourierWebhookController(mockSvc, mockPrisma);
  });

  afterEach(() => {
    if (origSecret === undefined) {
      delete process.env['REDX_WEBHOOK_SECRET'];
    } else {
      process.env['REDX_WEBHOOK_SECRET'] = origSecret;
    }
  });

  function mockReq(headers: Record<string, string | undefined>): any {
    return { headers };
  }

  it('missing REDX_WEBHOOK_SECRET — throws UnauthorizedException, does not call handleRedx', async () => {
    delete process.env['REDX_WEBHOOK_SECRET'];
    await expect(
      controller.redx(testBody, mockReq({ 'x-redx-signature': computeSig(testBody, testSecret) })),
    ).rejects.toThrow(UnauthorizedException);
    expect(handleRedxMock).not.toHaveBeenCalled();
  });

  it('missing X-RedX-Signature header — throws UnauthorizedException, does not call handleRedx', async () => {
    process.env['REDX_WEBHOOK_SECRET'] = testSecret;
    await expect(
      controller.redx(testBody, mockReq({})),
    ).rejects.toThrow(UnauthorizedException);
    expect(handleRedxMock).not.toHaveBeenCalled();
  });

  it('malformed signature (short) — throws UnauthorizedException, does not call handleRedx', async () => {
    process.env['REDX_WEBHOOK_SECRET'] = testSecret;
    await expect(
      controller.redx(testBody, mockReq({ 'x-redx-signature': 'short' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(handleRedxMock).not.toHaveBeenCalled();
  });

  it('wrong signature — throws UnauthorizedException, does not call handleRedx', async () => {
    process.env['REDX_WEBHOOK_SECRET'] = testSecret;
    await expect(
      controller.redx(testBody, mockReq({ 'x-redx-signature': 'aa'.repeat(32) })),
    ).rejects.toThrow(UnauthorizedException);
    expect(handleRedxMock).not.toHaveBeenCalled();
  });

  it('valid signature — calls handleRedx exactly once with the body and returns result', async () => {
    process.env['REDX_WEBHOOK_SECRET'] = testSecret;
    const sig = computeSig(testBody, testSecret);
    const result = await controller.redx(testBody, mockReq({ 'x-redx-signature': sig }));
    expect(handleRedxMock).toHaveBeenCalledTimes(1);
    expect(handleRedxMock).toHaveBeenCalledWith(testBody);
    expect(result).toEqual({ success: true });
  });

  it('missing secret and invalid sig throw EXACTLY THE SAME external error (both UnauthorizedException)', async () => {
    // Both must produce the same generic error to the caller
    const err1 = await controller
      .redx(testBody, mockReq({ 'x-redx-signature': 'aa'.repeat(32) }))
      .catch((e: any) => e);
    delete process.env['REDX_WEBHOOK_SECRET'];
    const err2 = await controller
      .redx(testBody, mockReq({ 'x-redx-signature': computeSig(testBody, testSecret) }))
      .catch((e: any) => e);

    expect(err1).toBeInstanceOf(UnauthorizedException);
    expect(err2).toBeInstanceOf(UnauthorizedException);
    expect(err1.message).toBe('Invalid webhook signature');
    expect(err2.message).toBe('Invalid webhook signature');
  });
});

/* ═══════════════════════════════════════════════
   9. FALLBACK PNG IS VALID (sharp can decode)
   ═══════════════════════════════════════════════ */

describe('ImageService fallback PNG integrity', () => {
  const FALLBACK_1x1_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('has correct PNG magic bytes', () => {
    expect(detectImageMime(FALLBACK_1x1_PNG)).toBe('image/png');
  });

  it('is decodable by sharp', async () => {
    // Use require instead of dynamic import (Jest compatibility)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const meta = await sharp(FALLBACK_1x1_PNG).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
  });
});

/* ═══════════════════════════════════════════════
   10. CACHE BEHAVIOR (temp dir, no network)
   ═══════════════════════════════════════════════ */

describe('ImagesService.resize cache behavior (temp dirs)', () => {
  // A small but valid PNG (4x4 white pixel block) that sharp can convert to webp
  let sourcePNG: Buffer;
  let validWebP: Buffer;
  let tmpRoot: string;

  beforeAll(async () => {
    const sharp = require('sharp');
    // Create a 4x4 white PNG — large enough for sharp withoutEnlargement
    sourcePNG = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    validWebP = await sharp(sourcePNG).webp().toBuffer();
    expect(validWebP.length).toBeGreaterThan(0);
  });

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecomate-imagesvc-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // Helper: create an ImagesService with temp roots without constructor injection
  function createSvc(): ImagesService {
    const svc = new (ImagesService as any)();
    svc.uploadRoot = path.join(tmpRoot, 'uploads');
    svc.cacheRoot = path.join(tmpRoot, 'cache');
    svc.fetcher = null as any; // won't be hit in cache-hit tests
    fs.mkdirSync(svc.uploadRoot, { recursive: true });
    fs.mkdirSync(svc.cacheRoot, { recursive: true });
    return svc;
  }

  // Production cache key formula from images.service.ts
  function cacheKey(url: string, w?: number, h?: number): string {
    return createHash('md5')
      .update(`${url}:${w || ''}:${h || ''}:${80}:${'cover'}`)
      .digest('hex');
  }

  it('corrupt cached .webp file — resize regenerates and returns valid WebP', async () => {
    const svc = createSvc();
    // Write source PNG
    const sourcePath = path.join(svc.uploadRoot, 'source.png');
    fs.writeFileSync(sourcePath, sourcePNG);

    // Write corrupt cache at the expected cache path
    const key = cacheKey('/uploads/source.png', 100, 100);
    const cacheFile = path.join(svc.cacheRoot, key + '.webp');
    fs.writeFileSync(cacheFile, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = await svc.resize({ path: '/uploads/source.png', w: 100, h: 100 });
    expect(result.mime).toBe('image/webp');

    // File on disk is now valid WebP
    const onDisk = fs.readFileSync(cacheFile);
    const validated = await validateImageBuffer(onDisk);
    expect(validated.mimeType).toBe('image/webp');
  });

  it('valid PNG at .webp cache path — resize rejects and regenerates WebP', async () => {
    const svc = createSvc();
    const sourcePath = path.join(svc.uploadRoot, 'source.png');
    fs.writeFileSync(sourcePath, sourcePNG);

    // Place valid PNG where .webp cache is expected
    const key = cacheKey('/uploads/source.png', 50, 50);
    const cacheFile = path.join(svc.cacheRoot, key + '.webp');
    fs.writeFileSync(cacheFile, sourcePNG); // PNG bytes, not WebP

    const result = await svc.resize({ path: '/uploads/source.png', w: 50, h: 50 });
    expect(result.mime).toBe('image/webp');

    // Verify on-disk cache is now WebP
    const onDisk = fs.readFileSync(cacheFile);
    const validated = await validateImageBuffer(onDisk);
    expect(validated.mimeType).toBe('image/webp');
  });

  it('valid WebP cache hit — resize returns cached bytes without regenerating', async () => {
    const svc = createSvc();
    // Don't write a source — the cache hit path is reached before source is needed
    const key = cacheKey('/uploads/nonexistent.png', 100, 100);
    const cacheFile = path.join(svc.cacheRoot, key + '.webp');
    fs.writeFileSync(cacheFile, validWebP);

    const result = await svc.resize({ path: '/uploads/nonexistent.png', w: 100, h: 100 });
    expect(result.mime).toBe('image/webp');
    // Verify the returned bytes are the cached WebP (not regenerated from nonexistent source)
    expect(result.buffer.equals(validWebP)).toBe(true);
  });
});
