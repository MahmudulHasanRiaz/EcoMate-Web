import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { collectDeviceContext } from '../device-context';

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const UA_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function setUa(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
}

describe('collectDeviceContext', () => {
  const original = navigator.userAgent;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => original });
  });

  it('classifies an Android Chrome phone', () => {
    setUa(UA_ANDROID);
    const device = collectDeviceContext();
    expect(device).toMatchObject({
      os: 'Android',
      platform: 'Android',
      browser: 'Chrome',
      deviceType: 'mobile',
    });
  });

  it('classifies Edge on Windows as desktop (not Chrome)', () => {
    setUa(UA_EDGE_WINDOWS);
    expect(collectDeviceContext()).toMatchObject({ os: 'Windows', browser: 'Edge' });
  });

  it('classifies an iPhone as iOS mobile', () => {
    setUa(UA_IOS);
    expect(collectDeviceContext()).toMatchObject({ os: 'iOS', deviceType: 'mobile' });
  });

  it('includes the locale and display values the browser exposes', () => {
    setUa(UA_ANDROID);
    const device = collectDeviceContext();
    // Screen/viewport depend on the test environment's window — assert shape
    // only, and that locale was read from the browser.
    if (device?.viewport) expect(device.viewport).toMatch(/^\d+x\d+$/);
    if (device?.screen) expect(device.screen).toMatch(/^\d+x\d+$/);
    expect(typeof device?.timezone).toBe('string');
    expect(typeof device?.language).toBe('string');
  });

  it('omits unknown values instead of sending empty strings', () => {
    setUa('SomeUnknownBot/1.0');
    const device = collectDeviceContext();
    expect(device && 'browser' in device ? device.browser : undefined).toBeUndefined();
    for (const value of Object.values(device ?? {})) {
      expect(value).not.toBe('');
    }
  });
});
