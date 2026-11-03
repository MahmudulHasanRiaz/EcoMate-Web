import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { POST } from '../route';

const mockedRevalidateTag = vi.mocked(revalidateTag);
const SECRET = 'test-revalidation-secret';

function makeRequest(opts: {
  secret?: string | null;
  body?: unknown;
  url?: string;
} = {}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.secret) headers.set('x-revalidation-secret', opts.secret);
  return new Request(opts.url ?? 'http://localhost/api/revalidate', {
    method: 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

describe('POST /api/revalidate (P4)', () => {
  beforeEach(() => {
    mockedRevalidateTag.mockReset();
  });

  afterEach(() => {
    delete process.env.REVALIDATION_SECRET;
    vi.restoreAllMocks();
  });

  it('is disabled (401, no revalidation) when REVALIDATION_SECRET is unset', async () => {
    delete process.env.REVALIDATION_SECRET;
    const res = await POST(makeRequest({ secret: SECRET, body: { tags: ['products'] } }));
    expect(res.status).toBe(401);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret with 401 and does not revalidate', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(makeRequest({ secret: 'wrong-secret-value', body: { tags: ['products'] } }));
    expect(res.status).toBe(401);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('rejects a missing secret with 401', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(makeRequest({ body: { tags: ['products'] } }));
    expect(res.status).toBe(401);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('revalidates allowlisted tags from the JSON body with immediate expiry', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(makeRequest({ secret: SECRET, body: { tags: ['products', 'config'] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revalidated: true, tags: ['products', 'config'] });
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(2);
    expect(mockedRevalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    expect(mockedRevalidateTag).toHaveBeenCalledWith('config', { expire: 0 });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('accepts a Bearer authorization header and ?tag= query params', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const req = new Request('http://localhost/api/revalidate?tag=config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockedRevalidateTag).toHaveBeenCalledWith('config', { expire: 0 });
  });

  it('returns 400 and revalidates nothing for unknown tags only', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(makeRequest({ secret: SECRET, body: { tags: ['orders', 'secrets'] } }));
    expect(res.status).toBe(400);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('ignores unknown tags when at least one valid tag is present', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(makeRequest({ secret: SECRET, body: { tags: ['products', 'bogus'] } }));
    expect(res.status).toBe(200);
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockedRevalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
  });
});
