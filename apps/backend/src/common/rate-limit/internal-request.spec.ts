import { isInternalRequest, isPrivateIp } from './internal-request';

/**
 * F1+F2 (owner decisions, avelto follow-ups): the rate-limit exemption for
 * internal calls requires BOTH the shared-secret header AND a private TCP
 * peer. Either factor alone must never suffice — x-forwarded-for is
 * client-controlled and is deliberately never consulted.
 */
describe('isPrivateIp', () => {
  it.each([
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '127.0.0.1',
    '169.254.1.1',
    '::1',
    'fe80::1',
    'fd00::8',
    '::ffff:192.168.0.9',
  ])('treats %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '1.1.1.1', '203.0.113.7', '', undefined, null])(
    'treats %s as public/not-private',
    (ip) => {
      expect(isPrivateIp(ip as any)).toBe(false);
    },
  );
});

describe('isInternalRequest', () => {
  const SECRET = 'test-internal-secret-value';
  const makeReq = (peer: string, header?: string, xff?: string) =>
    ({
      headers: {
        ...(header !== undefined ? { 'x-internal-secret': header } : {}),
        ...(xff ? { 'x-forwarded-for': xff } : {}),
      },
      socket: { remoteAddress: peer },
      ip: xff || peer,
    }) as any;

  beforeEach(() => {
    process.env.INTERNAL_SHARED_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.INTERNAL_SHARED_SECRET;
  });

  it('accepts secret + private peer', () => {
    expect(isInternalRequest(makeReq('172.18.0.3', SECRET))).toBe(true);
  });

  it('rejects secret from a PUBLIC peer (leaked secret cannot be replayed from the internet)', () => {
    expect(isInternalRequest(makeReq('203.0.113.9', SECRET))).toBe(false);
  });

  it('rejects a private peer without the secret', () => {
    expect(isInternalRequest(makeReq('10.0.0.2'))).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(isInternalRequest(makeReq('10.0.0.2', 'wrong-secret-value-here'))).toBe(false);
  });

  it('never trusts x-forwarded-for: a public peer claiming a private XFF is rejected', () => {
    expect(isInternalRequest(makeReq('203.0.113.9', SECRET, '10.0.0.1'))).toBe(false);
  });

  it('is OFF entirely when the env secret is not configured', () => {
    delete process.env.INTERNAL_SHARED_SECRET;
    expect(isInternalRequest(makeReq('127.0.0.1', SECRET))).toBe(false);
  });
});
