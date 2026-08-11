import {
  resolveActionSource,
  isMetaActionSource,
} from './meta-action-source';

describe('Meta action_source resolver (spec §11)', () => {
  it('maps website orders to website regardless of platform', () => {
    expect(resolveActionSource({ salesChannel: 'WEBSITE' })).toBe('website');
    expect(
      resolveActionSource({ salesChannel: 'WEBSITE', sourcePlatform: 'FACEBOOK', sourceType: 'AD' }),
    ).toBe('website');
    expect(
      resolveActionSource({ salesChannel: 'WEBSITE', sourcePlatform: 'INSTAGRAM', sourceType: 'AD' }),
    ).toBe('website');
    expect(
      resolveActionSource({ salesChannel: 'WEBSITE', sourcePlatform: 'TIKTOK', sourceType: 'AD' }),
    ).toBe('website');
    expect(
      resolveActionSource({ salesChannel: 'WEBSITE', sourcePlatform: 'DIRECT', sourceType: 'DIRECT' }),
    ).toBe('website');
  });

  it('maps POS / walk-in / showroom orders to physical_store', () => {
    expect(resolveActionSource({ salesChannel: 'POS' })).toBe('physical_store');
    expect(resolveActionSource({ salesChannel: 'WALK_IN' })).toBe('physical_store');
    expect(
      resolveActionSource({ salesChannel: 'POS', sourcePlatform: 'POS', sourceType: 'SHOWROOM', sourceEntity: 'Dhanmondi Showroom' }),
    ).toBe('physical_store');
    expect(resolveActionSource({ salesChannel: 'WALK_IN', sourceType: 'SHOWROOM' })).toBe('physical_store');
  });

  it('maps call orders to phone_call', () => {
    expect(resolveActionSource({ salesChannel: 'CALL' })).toBe('phone_call');
    expect(
      resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'PHONE', sourceType: 'CALL' }),
    ).toBe('phone_call');
    expect(
      resolveActionSource({ salesChannel: 'OFFLINE', sourceType: 'CALL' }),
    ).toBe('phone_call');
  });

  it('maps chat sources to chat (Messenger/WhatsApp/TikTok chat)', () => {
    expect(
      resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'MESSENGER', sourceType: 'CHAT' }),
    ).toBe('chat');
    expect(
      resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'WHATSAPP', sourceType: 'CHAT' }),
    ).toBe('chat');
    expect(
      resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'TIKTOK', sourceType: 'CHAT' }),
    ).toBe('chat');
    expect(
      resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'FACEBOOK', sourceType: 'CHAT' }),
    ).toBe('chat');
  });

  it('treats legacy social sales channels as chat (old one-field model)', () => {
    expect(resolveActionSource({ salesChannel: 'FACEBOOK' })).toBe('chat');
    expect(resolveActionSource({ salesChannel: 'WHATSAPP' })).toBe('chat');
    expect(resolveActionSource({ salesChannel: 'MESSENGER' })).toBe('chat');
    expect(resolveActionSource({ salesChannel: 'INSTAGRAM' })).toBe('chat');
  });

  it('infers chat/phone_call for OFFLINE without an explicit sourceType', () => {
    expect(resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'WHATSAPP' })).toBe('chat');
    expect(resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'FACEBOOK' })).toBe('chat');
    expect(resolveActionSource({ salesChannel: 'OFFLINE', sourcePlatform: 'PHONE' })).toBe('phone_call');
    expect(resolveActionSource({ salesChannel: 'OFFLINE' })).toBe('physical_store');
  });

  it('falls back to the configured default for empty attribution', () => {
    expect(resolveActionSource({})).toBe('website');
    expect(resolveActionSource({ salesChannel: null })).toBe('website');
    expect(resolveActionSource({ salesChannel: 'OTHER' })).toBe('physical_store');
  });

  it('every produced value is a valid Meta CAPI action_source', () => {
    const contexts = [
      { salesChannel: 'WEBSITE' },
      { salesChannel: 'POS', sourceType: 'SHOWROOM' },
      { salesChannel: 'CALL' },
      { salesChannel: 'OFFLINE', sourceType: 'CHAT' },
      { salesChannel: 'WALK_IN' },
    ];
    for (const ctx of contexts) {
      const value = resolveActionSource(ctx);
      expect(isMetaActionSource(value)).toBe(true);
    }
  });

  it('exposes a non-empty documented enum', () => {
    expect(isMetaActionSource('website')).toBe(true);
    expect(isMetaActionSource('physical_store')).toBe(true);
    expect(isMetaActionSource('phone_call')).toBe(true);
    expect(isMetaActionSource('chat')).toBe(true);
    expect(isMetaActionSource('not-a-real-source')).toBe(false);
  });
});