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

  describe('platform click ids beyond Meta', () => {
    it('captures Google, Bing, X and Instagram click ids', () => {
      setUrl('?gclid=g-1&msclkid=m-1&twclid=t-1&igshid=i-1&wbraid=w-1&gbraid=gb-1');
      const att = captureLandingAttribution();
      expect(att).toMatchObject({
        gclid: 'g-1',
        msclkid: 'm-1',
        twclid: 't-1',
        igshid: 'i-1',
        wbraid: 'w-1',
        gbraid: 'gb-1',
      });
    });

    it('keeps the generic clickId on the highest-precedence id present', () => {
      // fbclid outranks gclid — the same order the backend resolver uses.
      setUrl('?gclid=g-1&fbclid=fb-1');
      expect(captureLandingAttribution()?.clickId).toBe('fb-1');

      sessionStorage.clear();
      setUrl('?gclid=g-1&ttclid=t-1');
      expect(captureLandingAttribution()?.clickId).toBe('g-1');
    });

    it('captures a Google Ads landing that has no utm parameters at all', () => {
      setUrl('?gclid=Cj0KCQjw');
      const att = captureLandingAttribution();
      expect(att?.gclid).toBe('Cj0KCQjw');
      expect(att?.clickId).toBe('Cj0KCQjw');
      expect(att?.utmSource).toBeUndefined();
    });
  });
});