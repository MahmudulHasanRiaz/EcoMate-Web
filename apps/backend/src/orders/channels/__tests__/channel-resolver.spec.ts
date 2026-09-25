/**
 * ChannelResolver full-table suite — central-commerce P8 (§9.2, BR-18).
 * One case per table row plus every additional rule. The resolver is pure;
 * these tests pin the contract so no writer can re-derive it differently.
 */
import { describe, expect, it } from '@jest/globals';
import {
  resolveChannels,
  normalizeChannelToken,
} from '../channel-resolver';

describe('ChannelResolver §9.2 table', () => {
  it('WEBSITE → ONLINE, NATIVE (no showroom), NULL marketing without a session', () => {
    expect(resolveChannels({ salesChannel: 'WEBSITE' })).toEqual({
      salesChannelType: 'ONLINE',
      showroomName: null,
      marketingChannel: null,
    });
  });

  it('WEBSITE + known utmSource → that platform', () => {
    expect(
      resolveChannels({ salesChannel: 'WEBSITE', utmSource: 'facebook' }),
    ).toEqual({
      salesChannelType: 'ONLINE',
      showroomName: null,
      marketingChannel: 'FACEBOOK',
    });
    expect(
      resolveChannels({ salesChannel: 'WEBSITE', utmSource: 'TIKTOK' }),
    ).toMatchObject({ marketingChannel: 'TIKTOK' });
  });

  it('WEBSITE + unknown utmSource → NULL (never fabricate)', () => {
    expect(
      resolveChannels({ salesChannel: 'WEBSITE', utmSource: 'google' }),
    ).toMatchObject({ salesChannelType: 'ONLINE', marketingChannel: null });
  });

  it('POS → OFFLINE + showroom from sourceEntity; sourcePlatform POS is not a platform', () => {
    expect(
      resolveChannels({
        salesChannel: 'POS',
        sourcePlatform: 'POS',
        sourceType: 'SHOWROOM',
        sourceEntity: 'Dhanmondi Showroom',
      }),
    ).toEqual({
      salesChannelType: 'OFFLINE',
      showroomName: 'Dhanmondi Showroom',
      marketingChannel: null,
    });
  });

  it('POS + platform-bearing sourcePlatform → that marketing channel', () => {
    expect(
      resolveChannels({ salesChannel: 'POS', sourcePlatform: 'WHATSAPP' }),
    ).toMatchObject({
      salesChannelType: 'OFFLINE',
      marketingChannel: 'WHATSAPP',
    });
  });

  it('WALK_IN → OFFLINE + resolvable showroom, always NULL marketing', () => {
    expect(
      resolveChannels({
        salesChannel: 'WALK_IN',
        sourceEntity: 'Mirpur Showroom',
        sourcePlatform: 'FACEBOOK',
      }),
    ).toEqual({
      salesChannelType: 'OFFLINE',
      showroomName: 'Mirpur Showroom',
      marketingChannel: null,
    });
    expect(resolveChannels({ salesChannel: 'WALK_IN' })).toMatchObject({
      showroomName: null,
      marketingChannel: null,
    });
  });

  it('CALL → OFFLINE, NULL showroom, NULL marketing (origin, not platform)', () => {
    expect(
      resolveChannels({
        salesChannel: 'CALL',
        sourcePlatform: 'PHONE',
        sourceType: 'CALL',
      }),
    ).toEqual({
      salesChannelType: 'OFFLINE',
      showroomName: null,
      marketingChannel: null,
    });
  });

  it('OFFLINE + platform-bearing sourcePlatform → that channel', () => {
    expect(
      resolveChannels({ salesChannel: 'OFFLINE', sourcePlatform: 'TIKTOK' }),
    ).toMatchObject({ salesChannelType: 'OFFLINE', marketingChannel: 'TIKTOK' });
    expect(
      resolveChannels({ salesChannel: 'OFFLINE' }),
    ).toMatchObject({ marketingChannel: null });
  });

  it('OTHER + platform → platform; OTHER without platform → OTHER', () => {
    expect(
      resolveChannels({ salesChannel: 'OTHER', sourcePlatform: 'MESSENGER' }),
    ).toMatchObject({ marketingChannel: 'MESSENGER' });
    expect(resolveChannels({ salesChannel: 'OTHER' })).toMatchObject({
      salesChannelType: 'OFFLINE',
      marketingChannel: 'OTHER',
    });
  });

  it.each([
    ['FACEBOOK', 'FACEBOOK'],
    ['MESSENGER', 'MESSENGER'],
    ['INSTAGRAM', 'INSTAGRAM'],
    ['TIKTOK', 'TIKTOK'],
    ['WHATSAPP', 'WHATSAPP'],
    ['THREADS', 'THREADS'],
  ])('platform legacy %s → OFFLINE + %s', (legacy, expected) => {
    expect(resolveChannels({ salesChannel: legacy })).toEqual({
      salesChannelType: 'OFFLINE',
      showroomName: null,
      marketingChannel: expected,
    });
  });

  it('NULL channel derives from source: POS→OFFLINE, ECOMMERCE→ONLINE, MANUAL→OFFLINE', () => {
    expect(
      resolveChannels({ salesChannel: null, source: 'POS', sourceEntity: 'Uttara' }),
    ).toEqual({
      salesChannelType: 'OFFLINE',
      showroomName: 'Uttara',
      marketingChannel: null,
    });
    expect(
      resolveChannels({ salesChannel: null, source: 'ECOMMERCE' }),
    ).toMatchObject({ salesChannelType: 'ONLINE' });
    expect(
      resolveChannels({ salesChannel: null, source: 'MANUAL' }),
    ).toMatchObject({ salesChannelType: 'OFFLINE' });
  });

  it('NULL channel + platform-bearing sourcePlatform → that channel', () => {
    expect(
      resolveChannels({ salesChannel: null, source: 'MANUAL', sourcePlatform: 'WHATSAPP' }),
    ).toMatchObject({ marketingChannel: 'WHATSAPP' });
  });

  it('NULL channel + NULL source → ONLINE (ECOMMERCE default)', () => {
    expect(resolveChannels({})).toMatchObject({ salesChannelType: 'ONLINE' });
  });
});

describe('ChannelResolver additional rules', () => {
  it('CHAT + FACEBOOK platform → FACEBOOK', () => {
    expect(
      resolveChannels({ salesChannel: 'OFFLINE', sourceType: 'CHAT', sourcePlatform: 'FACEBOOK' }),
    ).toMatchObject({ marketingChannel: 'FACEBOOK' });
  });

  it('CHAT + INSTAGRAM platform → INSTAGRAM_INBOX', () => {
    expect(
      resolveChannels({ salesChannel: 'OFFLINE', sourceType: 'CHAT', sourcePlatform: 'INSTAGRAM' }),
    ).toMatchObject({ marketingChannel: 'INSTAGRAM_INBOX' });
  });

  it('CHAT + TIKTOK platform → TIKTOK_INBOX', () => {
    expect(
      resolveChannels({ salesChannel: 'OFFLINE', sourceType: 'CHAT', sourcePlatform: 'TIKTOK' }),
    ).toMatchObject({ marketingChannel: 'TIKTOK_INBOX' });
  });

  it('legacy salesChannel chat strings map to inbox variants', () => {
    expect(resolveChannels({ salesChannel: 'Facebook Chat' })).toMatchObject({
      salesChannelType: 'OFFLINE',
      marketingChannel: 'FACEBOOK',
    });
    expect(resolveChannels({ salesChannel: 'Instagram Chat' })).toMatchObject({
      marketingChannel: 'INSTAGRAM_INBOX',
    });
    expect(resolveChannels({ salesChannel: 'TikTok Chat' })).toMatchObject({
      marketingChannel: 'TIKTOK_INBOX',
    });
  });

  it.each(['CALL', 'PHONE', 'DIRECT'])(
    'sourcePlatform %s never yields a marketing channel',
    (never) => {
      expect(
        resolveChannels({ salesChannel: 'OFFLINE', sourcePlatform: never }),
      ).toMatchObject({ marketingChannel: null });
      expect(
        resolveChannels({
          salesChannel: 'OFFLINE',
          sourceType: 'CHAT',
          sourcePlatform: never,
        }),
      ).toMatchObject({ marketingChannel: null });
      expect(
        resolveChannels({ salesChannel: 'WEBSITE', utmSource: never }),
      ).toMatchObject({ marketingChannel: null });
    },
  );

  it('CALL salesChannel never yields marketing even with a platform set', () => {
    expect(
      resolveChannels({ salesChannel: 'CALL', sourcePlatform: 'FACEBOOK' }),
    ).toMatchObject({ marketingChannel: null });
  });

  it('external-ingest marker (EXTERNAL_STORE platform) → ONLINE + NULL marketing', () => {
    expect(
      resolveChannels({
        sourcePlatform: 'EXTERNAL_STORE',
        sourceType: 'EXTERNAL_STORE:woocommerce',
        sourceEntity: 'Woo Store',
      }),
    ).toMatchObject({ salesChannelType: 'ONLINE', marketingChannel: null });
  });

  it('normalization is case/space-insensitive', () => {
    expect(normalizeChannelToken('  walk-in ')).toBe('WALK_IN');
    expect(resolveChannels({ salesChannel: 'website' })).toMatchObject({
      salesChannelType: 'ONLINE',
    });
  });

  it('deterministic: same input → same output', () => {
    const input = { salesChannel: 'POS', sourceEntity: 'X', sourcePlatform: 'Y' };
    expect(resolveChannels(input)).toEqual(resolveChannels(input));
  });
});
