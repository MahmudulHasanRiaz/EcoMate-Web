import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { siteUrl, publicMediaUrl } from '@/lib/site-url';

const SAVED = { ...process.env };

describe('siteUrl (F1/F3)', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it('prefers NEXT_PUBLIC_STOREFRONT_URL (docker-compose per-client origin)', () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://shop.example.com/';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://other.example.com';
    expect(siteUrl()).toBe('https://shop.example.com');
  });

  it('falls back to legacy NEXT_PUBLIC_BASE_URL', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://legacy.example.com/';
    expect(siteUrl()).toBe('https://legacy.example.com');
  });

  it('returns empty (never throws) when unset', () => {
    expect(siteUrl()).toBe('');
  });
});

describe('publicMediaUrl (F2)', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_STOREFRONT_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it('resolves relative media against the site origin', () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    expect(publicMediaUrl('/uploads/a.jpg')).toBe('https://test.local/uploads/a.jpg');
  });

  it('rewrites internal absolute hosts (backend/localhost/private IP) to the site origin', () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    expect(publicMediaUrl('http://backend:4000/uploads/a.jpg')).toBe('https://test.local/uploads/a.jpg');
    expect(publicMediaUrl('http://localhost:4000/uploads/a.jpg')).toBe('https://test.local/uploads/a.jpg');
    expect(publicMediaUrl('http://192.168.1.10:4000/uploads/a.jpg')).toBe('https://test.local/uploads/a.jpg');
  });

  it('leaves public absolute URLs (CDN, shop domain) untouched', () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://test.local';
    expect(publicMediaUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(publicMediaUrl('https://test.local/uploads/a.jpg')).toBe('https://test.local/uploads/a.jpg');
  });

  it('degrades gracefully when unset or empty', () => {
    expect(publicMediaUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(publicMediaUrl('http://backend:4000/uploads/a.jpg')).toBe('http://backend:4000/uploads/a.jpg');
    expect(publicMediaUrl(undefined)).toBeUndefined();
  });
});
