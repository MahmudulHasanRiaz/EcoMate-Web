import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMetadata } from '@/app/layout';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

// The root layout pulls next/font + a CSS import at module top level —
// both are build-time only and must be stubbed for the test runner.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));
vi.mock('@/app/globals.css', () => ({}));
vi.mock('next/script', () => ({ default: () => null }));

let mockConfigValue: any = {
  store: { name: 'Test Store' },
  branding: {},
  seo: { title: '', description: '', keywords: '' },
};

vi.mock('@/lib/api/storefront-config-server', () => ({
  getStorefrontConfigServer: vi.fn(async () => mockConfigValue),
  StorefrontConfigError: class StorefrontConfigError extends Error {},
}));

const ENV_KEYS = [
  'STORE_NEXT_PUBLIC_STOREFRONT_URL',
  'NEXT_PUBLIC_STOREFRONT_URL',
  'NEXT_PUBLIC_BASE_URL',
] as const;
let savedEnv: Record<string, string | undefined>;

describe('root layout generateMetadata — metadataBase from the canonical chain', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    mockConfigValue = {
      store: { name: 'Test Store' },
      branding: {},
      seo: { title: '', description: '', keywords: '' },
    };
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('Settings domain wins for metadataBase', async () => {
    mockConfigValue.canonicalDomain = 'https://shop.example.com';
    const meta = await generateMetadata();
    expect((meta.metadataBase as URL).toString()).toBe(
      'https://shop.example.com/',
    );
  });

  it('unset Settings domain → env-validated origin', async () => {
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://env.example.com';
    const meta = await generateMetadata();
    expect((meta.metadataBase as URL).toString()).toBe(
      'https://env.example.com/',
    );
  });

  it('invalid Settings domain → env-validated origin, never the bad value', async () => {
    mockConfigValue.canonicalDomain = 'http://shop.example.com:3001';
    process.env.NEXT_PUBLIC_STOREFRONT_URL = 'https://env.example.com';
    const meta = await generateMetadata();
    expect((meta.metadataBase as URL).toString()).toBe(
      'https://env.example.com/',
    );
  });

  it('nothing set → build-time placeholder (never throws)', async () => {
    const meta = await generateMetadata();
    expect((meta.metadataBase as URL).toString()).toBe('https://example.com/');
  });
});
