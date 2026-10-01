import {
  sanitizeDispatchPayload,
  SANITIZE_LIMITS,
  REDACTED,
} from '../sanitize-dispatch-payload';

describe('sanitizeDispatchPayload', () => {
  it('removes top-level secrets', () => {
    const out = sanitizeDispatchPayload({
      access_token: 'EAABxyz',
      api_key: 'k-123',
      authorization: 'Bearer abc',
      client_secret: 's-1',
      keep: 'visible',
    });
    const v = out.value as Record<string, any>;
    expect(v.access_token).toBe(REDACTED);
    expect(v.api_key).toBe(REDACTED);
    expect(v.authorization).toBe(REDACTED);
    expect(v.client_secret).toBe(REDACTED);
    expect(v.keep).toBe('visible');
  });

  it('removes secrets nested at any depth', () => {
    const out = sanitizeDispatchPayload({
      level1: { level2: { level3: { password: 'hunter2', data: 1 } } },
    });
    const v = out.value as any;
    expect(v.level1.level2.level3.password).toBe(REDACTED);
    expect(v.level1.level2.level3.data).toBe(1);
  });

  it('removes secrets inside arrays', () => {
    const out = sanitizeDispatchPayload({
      events: [{ api_key: 'k', id: 1 }, { id: 2 }],
    });
    const v = out.value as any;
    expect(v.events[0].api_key).toBe(REDACTED);
    expect(v.events[1].id).toBe(2);
  });

  it('catches credential-shaped keys the exact list would miss', () => {
    // A provider nesting a token under a non-standard name must still be caught.
    const out = sanitizeDispatchPayload({
      meta_access_token: 't',
      pixel_credentials: { anything: 'here' },
      webhook_signing_secret: 'w',
      data: 'kept',
    });
    const v = out.value as any;
    expect(v.meta_access_token).toBe(REDACTED);
    expect(v.pixel_credentials).toBe(REDACTED);
    expect(v.webhook_signing_secret).toBe(REDACTED);
    expect(v.data).toBe('kept');
  });

  it('does NOT redact ordinary event fields', () => {
    const payload = {
      event_name: 'Purchase',
      event_id: 'purchase_abc',
      value: 1290,
      currency: 'BDT',
      content_ids: ['SKU-1', 'SKU-2'],
      action_source: 'website',
    };
    const out = sanitizeDispatchPayload(payload);
    expect(out.value).toEqual(payload);
    expect(out.redactedPaths).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it('records the dotted path of each redaction', () => {
    const out = sanitizeDispatchPayload({
      a: { b: { api_key: 'x' } },
      top_secret: 'y',
    });
    expect(out.redactedPaths).toEqual(expect.arrayContaining(['top_secret', 'a.b.api_key']));
  });

  it('records array indices in redaction paths', () => {
    const out = sanitizeDispatchPayload({ list: [{ token: 'x' }] });
    expect(out.redactedPaths).toEqual(expect.arrayContaining(['list[0].token']));
  });

  it('truncates an oversized string and flags it', () => {
    const out = sanitizeDispatchPayload({ big: 'x'.repeat(5000) });
    expect(out.truncated).toBe(true);
    expect((out.value as any).big).toContain('truncated');
    expect((out.value as any).big.length).toBeLessThan(5000);
  });

  it('truncates an oversized array and flags it', () => {
    const out = sanitizeDispatchPayload({
      arr: Array.from({ length: SANITIZE_LIMITS.MAX_ARRAY_LENGTH + 50 }, (_, i) => i),
    });
    expect(out.truncated).toBe(true);
    expect((out.value as any).arr.length).toBe(SANITIZE_LIMITS.MAX_ARRAY_LENGTH);
  });

  it('truncates beyond the max depth and flags it', () => {
    let deep: any = { value: 'bottom' };
    for (let i = 0; i < SANITIZE_LIMITS.MAX_DEPTH + 5; i++) deep = { nested: deep };
    const out = sanitizeDispatchPayload(deep);
    expect(out.truncated).toBe(true);
  });

  it('enforces the serialized size bound', () => {
    // Many large strings: total serialized size exceeds the 64KB cap.
    const out = sanitizeDispatchPayload(
      Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`k${i}`, 'y'.repeat(1000)]),
      ),
    );
    expect(out.truncated).toBe(true);
    const size = Buffer.byteLength(JSON.stringify(out.value), 'utf8');
    expect(size).toBeLessThanOrEqual(SANITIZE_LIMITS.MAX_SERIALIZED_BYTES);
  });

  it('caps redactedPaths and records how many were omitted', () => {
    const payload: Record<string, unknown> = {};
    for (let i = 0; i < SANITIZE_LIMITS.MAX_REDACTED_PATHS + 30; i++) {
      payload[`secret_${i}`] = 'x';
    }
    const out = sanitizeDispatchPayload(payload);
    expect(out.redactedPaths.length).toBe(SANITIZE_LIMITS.MAX_REDACTED_PATHS + 1);
    expect(out.redactedPaths[out.redactedPaths.length - 1]).toContain('more removed');
  });

  it('computes size AFTER redaction so a secret cannot leak by overshoot', () => {
    // A tiny payload that would exceed the cap only if the secret were kept.
    const out = sanitizeDispatchPayload({ api_key: 'a'.repeat(2000), id: 1 });
    const v = out.value as any;
    expect(v.api_key).toBe(REDACTED);
    expect(String(v.api_key)).not.toContain('aaaa');
  });

  it('handles primitives and null without throwing', () => {
    expect(sanitizeDispatchPayload(null).value).toBeNull();
    expect(sanitizeDispatchPayload(42).value).toBe(42);
    expect(sanitizeDispatchPayload('str').value).toBe('str');
    expect(sanitizeDispatchPayload(true).value).toBe(true);
  });

  it('never emits the literal secret value anywhere in the output', () => {
    const SECRET = 'SUPER_SECRET_VALUE_123';
    const out = sanitizeDispatchPayload({
      authorization: SECRET,
      nested: { refresh_token: SECRET, keep: 'ok' },
    });
    expect(JSON.stringify(out.value)).not.toContain(SECRET);
  });
});
