/**
 * [10] Two-layer validation: the backend must not trust the client's dropdown.
 */
import {
  validateSourceForChannel,
  requiredCapabilityFor,
} from '../validate-source-for-channel';
import { SOURCE_PLATFORM_SEEDS } from '../sales-channel.constants';

const knownSlugs = new Set(SOURCE_PLATFORM_SEEDS.map((s) => s.slug));
const capabilitiesBySlug = new Map(
  SOURCE_PLATFORM_SEEDS.map((s) => [s.slug, s.capabilities as string[]]),
);

const check = (channel: any, sourceSlug: any) =>
  validateSourceForChannel({ channel, sourceSlug, knownSlugs, capabilitiesBySlug });

describe('validateSourceForChannel', () => {
  // ── Omitted is always fine ──────────────────────────────────────────────
  it('accepts an omitted source for every channel', () => {
    for (const ch of ['WEBSITE', 'MESSAGING', 'PHONE_CALL', 'POS', null]) {
      const r = check(ch, null);
      expect(r.ok).toBe(true);
      expect(r.sourceSlug).toBeNull();
    }
    expect(check('WEBSITE', undefined).ok).toBe(true);
    expect(check('WEBSITE', '   ').ok).toBe(true);
  });

  // ── Messaging requires the MESSAGING capability ─────────────────────────
  it('accepts a messaging-capable source on the Messaging channel', () => {
    for (const slug of ['facebook', 'instagram', 'whatsapp', 'tiktok', 'telegram']) {
      const r = check('MESSAGING', slug);
      expect(r.ok).toBe(true);
      expect(r.sourceSlug).toBe(slug);
    }
  });

  it('clears a non-messaging source on the Messaging channel and warns', () => {
    const r = check('MESSAGING', 'google');
    expect(r.ok).toBe(false);
    expect(r.sourceSlug).toBeNull();
    expect((r as any).warning).toContain('not valid for MESSAGING');
  });

  it('clears chatgpt on the Messaging channel (AI source, not messaging)', () => {
    const r = check('MESSAGING', 'chatgpt');
    expect(r.ok).toBe(false);
    expect(r.sourceSlug).toBeNull();
  });

  // ── Unknown / disabled platforms ────────────────────────────────────────
  it('clears an unregistered platform and warns', () => {
    const r = check('WEBSITE', 'totally-made-up');
    expect(r.ok).toBe(false);
    expect(r.sourceSlug).toBeNull();
    expect((r as any).warning).toContain('not a registered platform');
  });

  it('accepts google on the Website channel', () => {
    const r = check('WEBSITE', 'google');
    expect(r.ok).toBe(true);
    expect(r.sourceSlug).toBe('google');
  });

  it('accepts any registered platform on POS / PHONE_CALL', () => {
    for (const ch of ['POS', 'PHONE_CALL']) {
      expect(check(ch, 'facebook').ok).toBe(true);
      expect(check(ch, 'google').ok).toBe(true);
    }
  });

  // ── Normalisation ───────────────────────────────────────────────────────
  it('normalises case and surrounding whitespace', () => {
    const r = check('WEBSITE', '  Google  ');
    expect(r.ok).toBe(true);
    expect(r.sourceSlug).toBe('google');
  });

  // ── Never throws — an order must not be rejected over attribution ───────
  it('never throws for any combination', () => {
    const channels = ['WEBSITE', 'MESSAGING', 'PHONE_CALL', 'POS', null] as const;
    const sources = [null, '', 'google', 'facebook', 'nope', 'chatgpt', 'POS'];
    for (const ch of channels) {
      for (const s of sources) {
        expect(() => check(ch, s)).not.toThrow();
      }
    }
  });

  it('a cleared source always carries an explanation for the caller', () => {
    const bad = [check('MESSAGING', 'google'), check('WEBSITE', 'nope')];
    for (const r of bad) {
      expect(r.ok).toBe(false);
      expect(typeof (r as any).warning).toBe('string');
      expect((r as any).warning.length).toBeGreaterThan(0);
    }
  });

  // ── Capability requirement table ─────────────────────────────────────────
  describe('requiredCapabilityFor', () => {
    it('requires MESSAGING only for the Messaging channel', () => {
      expect(requiredCapabilityFor('MESSAGING')).toBe('MESSAGING');
      expect(requiredCapabilityFor('WEBSITE')).toBeNull();
      expect(requiredCapabilityFor('POS')).toBeNull();
      expect(requiredCapabilityFor('PHONE_CALL')).toBeNull();
      expect(requiredCapabilityFor(null)).toBeNull();
    });
  });
});
