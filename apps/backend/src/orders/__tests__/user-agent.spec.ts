import { parseUserAgent } from '../user-agent';

describe('parseUserAgent', () => {
  it('returns null for an absent or blank User-Agent', () => {
    expect(parseUserAgent(null)).toBeNull();
    expect(parseUserAgent(undefined)).toBeNull();
    expect(parseUserAgent('   ')).toBeNull();
  });

  it('parses Chrome on Windows desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const r = parseUserAgent(ua)!;
    expect(r.browser).toBe('Chrome');
    expect(r.browserVersion).toBe('120.0');
    expect(r.os).toBe('Windows');
    expect(r.osVersion).toBe('10');
    expect(r.deviceType).toBe('desktop');
    expect(r.platform).toBe('Win32');
    expect(r.isBot).toBe(false);
  });

  it('prefers Edge over Chrome when both are named', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua)!.browser).toBe('Edge');
  });

  it('parses Safari on iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
    const r = parseUserAgent(ua)!;
    expect(r.browser).toBe('Safari');
    expect(r.os).toBe('iOS');
    expect(r.osVersion).toBe('17.1');
    expect(r.deviceType).toBe('mobile');
  });

  it('parses Chrome on Android mobile', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    const r = parseUserAgent(ua)!;
    expect(r.browser).toBe('Chrome');
    expect(r.os).toBe('Android');
    expect(r.osVersion).toBe('13');
    expect(r.deviceType).toBe('mobile');
  });

  it('classifies an Android tablet without "Mobile" as a tablet', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)!.deviceType).toBe('tablet');
  });

  it('classifies an iPad as a tablet', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/604.1';
    expect(parseUserAgent(ua)!.deviceType).toBe('tablet');
  });

  it('detects a crawler and flags it as a bot', () => {
    const r = parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')!;
    expect(r.isBot).toBe(true);
    expect(r.deviceType).toBe('bot');
  });

  it('detects a headless client as a bot', () => {
    expect(parseUserAgent('Mozilla/5.0 HeadlessChrome/120.0.0.0')!.isBot).toBe(true);
  });

  it('reports null rather than guessing for an unrecognised string', () => {
    const r = parseUserAgent('some-unknown-agent/1.0')!;
    expect(r.browser).toBeNull();
    expect(r.deviceType).toBe('unknown');
  });

  it('never invents a browser or OS it cannot determine', () => {
    const r = parseUserAgent('curl/8.0.1')!;
    expect(r.browser).toBeNull();
    expect(r.os).toBeNull();
  });
});
