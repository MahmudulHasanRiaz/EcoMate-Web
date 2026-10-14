import { Readable } from 'node:stream';
import { collectRawBody, isWebhookRawBodyPath } from './webhook-raw-body';

describe('isWebhookRawBodyPath', () => {
  it('captures the four courier webhook paths', () => {
    for (const courier of ['steadfast', 'pathao', 'redx', 'carrybee']) {
      expect(isWebhookRawBodyPath(`/api/webhooks/courier/${courier}`)).toBe(true);
    }
  });

  it('captures RedX callback URLs carrying ?token= (query stripped for matching)', () => {
    expect(isWebhookRawBodyPath('/api/webhooks/courier/redx?token=abc123')).toBe(true);
  });

  it('ignores every other route', () => {
    expect(isWebhookRawBodyPath('/api/couriers/credentials')).toBe(false);
    expect(isWebhookRawBodyPath('/api/orders')).toBe(false);
    expect(isWebhookRawBodyPath(undefined)).toBe(false);
    expect(isWebhookRawBodyPath('/api/webhooks/other')).toBe(false);
  });
});

describe('collectRawBody', () => {
  it('reassembles chunked streams byte-identically', async () => {
    const original = '{"status":"delivered","consignment_id":12345}';
    const stream = Readable.from([
      Buffer.from(original.slice(0, 10)),
      Buffer.from(original.slice(10, 25)),
      Buffer.from(original.slice(25)),
    ]);
    const buf = await collectRawBody(stream);
    expect(buf.toString('utf8')).toBe(original);
  });
});
