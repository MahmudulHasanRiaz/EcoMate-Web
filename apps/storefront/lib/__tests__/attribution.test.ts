import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  captureLandingAttribution,
  getLandingAttribution,
  clearLandingAttribution,
  type LandingAttribution,
} from '../attribution';

const KEY = 'ecomate_attribution_v1';

describe('landing attribution capture (spec §21)', () => {
  const originalHref = window.location.href;

  const setUrl = (search: string) => {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search}`,
    );
  };

  const setReferrer = (referrer: string) => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => referrer,
    });
  };

  beforeEach(() => {
    sessionStorage.clear();
    setUrl('');
    setReferrer('');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.history.replaceState(null, '', originalHref);
    sessionStorage.clear();
  });

  it('captures utm params + click ids + referrer from the landing URL', () => {
    setUrl('?utm_source=facebook&utm_medium=cpc&fbclid=abc');
    setReferrer('https://t.co/x');
    const att = captureLandingAttribution();
    expect(att).toMatchObject({
      utmSource: 'facebook',
      utmMedium: 'cpc',
      fbclid: 'abc',
      referrer: 'https://t.co/x',
    });
  });

  it('first capture wins (session landing is authoritative)', () => {
    setUrl('?utm_source=tiktok');
    captureLandingAttribution();
    // Navigate to a different URL mid-session — the landing stays.
    setUrl('?utm_source=instagram&utm_medium=paid');
    const att = getLandingAttribution();
    expect(att?.utmSource).toBe('tiktok');
  });

  it('persists across reads and can be cleared after a completed order', () => {
    setUrl('?utm_source=threads');
    const one = getLandingAttribution();
    const two = getLandingAttribution();
    expect(one).toEqual(two);
    expect(two?.utmSource).toBe('threads');

    clearLandingAttribution();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(getLandingAttribution()).not.toBeNull(); // recollects on demand
  });

  it('tolerates no attribution present (direct visit)', () => {
    setUrl('');
    const att = captureLandingAttribution();
    expect(att).not.toBeNull();
    expect(att?.utmSource).toBeUndefined();
    expect(att?.fbclid).toBeUndefined();
  });
});