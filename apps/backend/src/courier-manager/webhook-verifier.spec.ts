import * as crypto from 'node:crypto';
import {
  timingSafeEqualText,
  verifyRawHmacSha256Hex,
  verifyVerbatimSecret,
} from './webhook-verifier';

const SECRET = 'test-webhook-token-abc123';

function sign(rawBody: string | Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('timingSafeEqualText', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqualText('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings of equal length without throwing', () => {
    expect(timingSafeEqualText('abc123', 'abc124')).toBe(false);
  });

  it('rejects different-length strings without throwing', () => {
    expect(timingSafeEqualText('short', 'a-much-longer-string')).toBe(false);
  });
});

describe('verifyRawHmacSha256Hex (Task 4: HMAC over RAW body bytes)', () => {
  const rawBody = '{"consignment_id":12345,"status":"delivered"}';

  it('accepts a valid HMAC of the exact raw bytes', () => {
    expect(() =>
      verifyRawHmacSha256Hex(rawBody, sign(rawBody, SECRET), SECRET),
    ).not.toThrow();
  });

  it('rejects a tampered body against the original signature (401 path)', () => {
    const tampered = '{"consignment_id":12345,"status":"cancelled"}';
    expect(() =>
      verifyRawHmacSha256Hex(tampered, sign(rawBody, SECRET), SECRET),
    ).toThrow('Invalid webhook signature');
  });

  it('rejects signatures of the wrong secret (token-present-fail → 401)', () => {
    expect(() =>
      verifyRawHmacSha256Hex(rawBody, sign(rawBody, 'wrong-secret'), SECRET),
    ).toThrow('Invalid webhook signature');
  });

  it('rejects missing/empty/malformed signatures without crashing', () => {
    for (const bad of [undefined, '', 'not-hex', 'abc123']) {
      expect(() => verifyRawHmacSha256Hex(rawBody, bad, SECRET)).toThrow(
        'Invalid webhook signature',
      );
    }
  });

  it('throws not-configured (never 401-mapped) when no secret is set', () => {
    expect(() =>
      verifyRawHmacSha256Hex(rawBody, sign(rawBody, SECRET), undefined),
    ).toThrow(/not configured/);
    expect(() => verifyRawHmacSha256Hex(rawBody, sign(rawBody, SECRET), '')).toThrow(
      /not configured/,
    );
  });

  it('is byte-exact: semantically-equal JSON with different whitespace fails', () => {
    const pretty = '{ "consignment_id": 12345, "status": "delivered" }';
    // Same parsed object, different bytes → the raw-body HMAC must NOT verify.
    expect(JSON.parse(pretty)).toEqual(JSON.parse(rawBody));
    expect(() =>
      verifyRawHmacSha256Hex(pretty, sign(rawBody, SECRET), SECRET),
    ).toThrow('Invalid webhook signature');
  });
});

describe('verifyVerbatimSecret (Pathao/Carrybee verbatim compare)', () => {
  it('accepts the exact registered secret', () => {
    expect(() => verifyVerbatimSecret('registered-V', 'registered-V')).not.toThrow();
  });

  it('rejects mismatches (incl. the public integration constant)', () => {
    expect(() => verifyVerbatimSecret('f3992ecc-59da-4cbe-a049-a13da2018d51', 'registered-V')).toThrow(
      'Invalid webhook signature',
    );
  });

  it('throws not-configured when no secret is stored', () => {
    expect(() => verifyVerbatimSecret('anything', undefined)).toThrow(/not configured/);
    expect(() => verifyVerbatimSecret(undefined, 'registered-V')).toThrow(
      'Invalid webhook signature',
    );
  });
});
