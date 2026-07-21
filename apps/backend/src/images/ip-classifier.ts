import { URL } from 'node:url';
import { isIPv4, isIPv6 } from 'node:net';
import * as ipaddr from 'ipaddr.js';

/**
 * IP address classification for SSRF protection.
 * Uses ipaddr.js for robust, exhaustive parsing.
 */

// IANA IPv4 Special-Purpose blocks as CIDR strings
const PRIVATE_V4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.31.196.0/24',
  '192.52.193.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '192.175.48.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

// IANA IPv6 Special-Purpose blocks
const PRIVATE_V6_CIDRS = [
  '::1/128',
  '::/128',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '100::/64',
  '2001::/32',
  '2001:2::/48',
  '2001:3::/32',
  '2001:4:112::/48',
  '2001:10::/28',
  '2001:20::/28',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

/**
 * Returns true for any address that is NOT globally routable unicast:
 * private, loopback, link-local, multicast, reserved, documentation, etc.
 */
export function isBlockedIP(addr: string): boolean {
  try {
    const parsed = ipaddr.parse(addr);
    const kind = parsed.kind();

    if (kind === 'ipv4') {
      const v4 = parsed as ipaddr.IPv4;
      for (const cidr of PRIVATE_V4_CIDRS) {
        const [range, bits] = ipaddr.parseCIDR(cidr);
        if (v4.match(range as ipaddr.IPv4, bits)) return true;
      }
      return false;
    }

    if (kind === 'ipv6') {
      const v6 = parsed as ipaddr.IPv6;
      for (const cidr of PRIVATE_V6_CIDRS) {
        const [range, bits] = ipaddr.parseCIDR(cidr);
        if (v6.match(range as ipaddr.IPv6, bits)) return true;
      }
      return false;
    }

    return true; // unknown kind — reject
  } catch {
    return true; // parse failure — reject
  }
}

export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export const defaultDns: DnsResolver = {
  resolve4: async (h) => {
    const dns = await import('node:dns/promises');
    return dns.resolve4(h).catch(() => [] as string[]);
  },
  resolve6: async (h) => {
    const dns = await import('node:dns/promises');
    return dns.resolve6(h).catch(() => [] as string[]);
  },
};

/**
 * Validate URL format, resolve hostname, check every returned IP against blocked ranges.
 * Returns the validated URL and a pinned address to connect to.
 * Mixed public+private DNS → reject. Empty/no DNS → reject (fail-closed).
 * DNS respects the given abortSignal for deadline.
 */
export async function resolveAndPin(
  hostname: string,
  dnsResolver?: DnsResolver,
  signal?: AbortSignal,
): Promise<string> {
  const dns = dnsResolver ?? defaultDns;

  // Already an IP — validate directly
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new Error('Private/reserved IP addresses are not allowed');
    }
    return hostname;
  }

  // Normalize bracketed IPv6 for validation
  let h = hostname;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (isIPv6(h)) {
    if (isBlockedIP(h)) throw new Error('Private/reserved IP addresses are not allowed');
    return h;
  }

  // Race DNS resolution against abort signal
  const dnsPromise = Promise.all([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);

  const [v4addrs, v6addrs] = signal
    ? await Promise.race([
        dnsPromise,
        new Promise<[string[], string[]]>((_, reject) => {
          if (signal.aborted) return reject(signal.reason ?? new Error('DNS aborted'));
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('DNS aborted')), { once: true });
        }),
      ])
    : await dnsPromise;

  const all = [...v4addrs, ...v6addrs];

  if (all.length === 0) {
    throw new Error('DNS resolution returned no addresses');
  }

  // Reject if ANY returned address is blocked ("mixed" → reject)
  for (const addr of all) {
    if (isBlockedIP(addr)) {
      throw new Error('DNS resolution resolved to a blocked IP');
    }
  }

  return v4addrs[0] || v6addrs[0];
}

/**
 * Pre-request URL validation only (no DNS).
 * Strips brackets from IPv6 hostnames before passing to ipaddr.js.
 */
export function validateImageUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL must not contain embedded credentials');
  }

  // Strip brackets for IPv6 before IP check
  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  if (isIPv4(host) || isIPv6(host)) {
    if (isBlockedIP(host)) {
      throw new Error('Private/reserved IP addresses are not allowed');
    }
  }

  return parsed;
}
