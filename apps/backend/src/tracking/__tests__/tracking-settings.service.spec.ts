import { ConfigService } from '@nestjs/config';
import { TrackingSettingsService } from '../tracking-settings.service';
import { TrackingNormalizer } from '../tracking.normalizer';

describe('TrackingSettingsService', () => {
  const findUnique = jest.fn();
  const prisma = { systemSetting: { findUnique } } as any;
  const config = new ConfigService();

  const service = new TrackingSettingsService(prisma, config);

  beforeEach(() => {
    jest.clearAllMocks();
    config.set('META_PIXEL_ID', '');
  });

  it('reads a system setting when present', async () => {
    findUnique.mockResolvedValue({ key: 'tracking_meta_pixel_id', value: 'PIX-1' });
    await expect(service.get('tracking_meta_pixel_id', null)).resolves.toBe('PIX-1');
    expect(findUnique).toHaveBeenCalledWith({ where: { key: 'tracking_meta_pixel_id' } });
  });

  it('falls back to env when the setting is absent', async () => {
    findUnique.mockResolvedValue(null);
    config.set('META_PIXEL_ID', 'PIX-ENV');
    await expect(service.get('tracking_meta_pixel_id', 'META_PIXEL_ID')).resolves.toBe('PIX-ENV');
  });

  it('returns null when setting and env are both absent', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.get('tracking_meta_pixel_id', 'META_PIXEL_ID')).resolves.toBeNull();
  });

  it('treats a read error as absent and falls back to env', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    config.set('META_PIXEL_ID', 'PIX-ENV');
    await expect(service.get('tracking_meta_pixel_id', 'META_PIXEL_ID')).resolves.toBe('PIX-ENV');
  });

  it('isEnabled returns true only for the string "true"', async () => {
    findUnique.mockResolvedValue({ key: 'tracking_meta_enabled', value: 'true' });
    await expect(service.isEnabled('tracking_meta_enabled')).resolves.toBe(true);
    findUnique.mockResolvedValue({ key: 'tracking_meta_enabled', value: 'false' });
    await expect(service.isEnabled('tracking_meta_enabled')).resolves.toBe(false);
  });

  it('isEnabledOrDefault uses the default when the key is absent (Wave-1 safety guards)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.isEnabledOrDefault('tracking_event_age_guard', true)).resolves.toBe(true);
    await expect(service.isEnabledOrDefault('tracking_event_age_guard', false)).resolves.toBe(false);
  });

  describe('Step 3 — Meta destinations + token-free config snapshot', () => {
    /** Mock the settings table from a plain key→value map. */
    const useSettings = (map: Record<string, string>) => {
      findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          map[where.key] !== undefined
            ? { key: where.key, value: map[where.key] }
            : null,
        ),
      );
    };

    it('synthesizes the legacy single destination when no destination array is configured', async () => {
      useSettings({
        tracking_meta_pixel_id: 'LEGACY-PIXEL',
        tracking_meta_access_token: 'LEGACY-TOKEN',
      });

      const destinations = await service.getMetaDestinations();

      expect(destinations).toHaveLength(1);
      expect(destinations[0]).toMatchObject({
        id: 'default',
        pixelId: 'LEGACY-PIXEL',
        accessToken: 'LEGACY-TOKEN',
        enabled: true,
        browserPixelEnabled: true,
      });
    });

    it('prefers the configured destination array over the legacy fields', async () => {
      useSettings({
        tracking_meta_pixel_id: 'LEGACY-PIXEL',
        tracking_meta_destinations: JSON.stringify([
          {
            id: 'primary',
            label: 'A',
            pixelId: '111',
            accessToken: 'tok-A',
            enabled: true,
            browserPixelEnabled: true,
          },
          {
            id: 'secondary',
            label: 'B',
            pixelId: '222',
            accessToken: 'tok-B',
            enabled: true,
            browserPixelEnabled: true,
          },
        ]),
      });

      const destinations = await service.getMetaDestinations();

      expect(destinations.map((d) => d.id)).toEqual(['primary', 'secondary']);
      expect(destinations.map((d) => d.pixelId)).toEqual(['111', '222']);
    });

    it('records capture-time destinations in the snapshot WITHOUT any access token', async () => {
      useSettings({
        tracking_meta_enabled: 'true',
        tracking_meta_purchase_mode: 'instant',
        currency: 'BDT',
        tracking_meta_destinations: JSON.stringify([
          {
            id: 'primary',
            label: 'A',
            pixelId: '111',
            accessToken: 'SUPER-SECRET-TOKEN',
            enabled: true,
            browserPixelEnabled: true,
          },
        ]),
      });

      const snapshot = await service.buildConfigSnapshot();

      expect(snapshot.destinations).toEqual([
        { provider: 'meta', destinationId: 'primary', pixelId: '111', purchaseMode: 'instant' },
      ]);
      // The snapshot is copied verbatim into the durable replay archive — a token
      // in here would be a long-lived secret leak.
      expect(JSON.stringify(snapshot)).not.toContain('SUPER-SECRET-TOKEN');
      expect(snapshot.successPolicy).toBe('ALL_SENT');
      expect(snapshot.normalizerVersion).toBe(2);
      expect(snapshot.enabledProviders).toContain('meta');
    });

    it('excludes an enabled-but-destination-less provider from the work set', async () => {
      useSettings({
        tracking_meta_enabled: 'true',
        currency: 'BDT',
        // Meta enabled, but no pixel id anywhere → nothing to deliver to.
      });

      const snapshot = await service.buildConfigSnapshot();

      expect(snapshot.destinations).toEqual([]);
      expect(snapshot.enabledProviders).not.toContain('meta');
    });

    it('records the capture-time eligibility only for ENABLED destinations', async () => {
      useSettings({
        tracking_meta_enabled: 'true',
        currency: 'BDT',
        tracking_meta_destinations: JSON.stringify([
          { id: 'on', pixelId: '111', accessToken: 't', enabled: true },
          { id: 'off', pixelId: '222', accessToken: 't', enabled: false },
        ]),
      });

      const snapshot = await service.buildConfigSnapshot();

      expect((snapshot.destinations as any[]).map((d) => d.destinationId)).toEqual(['on']);
    });
  });

  it('isEnabledOrDefault honors an explicit value and env fallback', async () => {
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_event_age_guard'
        ? Promise.resolve({ key: where.key, value: 'false' })
        : Promise.resolve(null),
    );
    await expect(service.isEnabledOrDefault('tracking_event_age_guard', true)).resolves.toBe(false);

    findUnique.mockResolvedValue(null);
    config.set('TRACKING_EVENT_AGE_GUARD', 'true');
    await expect(
      service.isEnabledOrDefault('tracking_event_age_guard', false, 'TRACKING_EVENT_AGE_GUARD'),
    ).resolves.toBe(true);
  });

  it('gates test_event_code on the provider test-mode flag', async () => {
    // test mode off -> null even though a code exists
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_meta_test_mode'
        ? Promise.resolve(null)
        : Promise.resolve({ key: where.key, value: 'TEST123' }),
    );
    await expect(service.getTestEventCode('meta')).resolves.toBeNull();

    // test mode on -> code returned
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_meta_test_mode'
        ? Promise.resolve({ key: where.key, value: 'true' })
        : Promise.resolve({ key: where.key, value: 'TEST123' }),
    );
    await expect(service.getTestEventCode('meta')).resolves.toBe('TEST123');
  });

  it('buildConfigSnapshot lists settings-enabled providers and normalizer version', async () => {
    findUnique.mockImplementation(({ where }) => {
      if (where.key === 'tracking_meta_enabled')
        return Promise.resolve({ key: where.key, value: 'true' });
      // Step 3: meta is enabled only when it has somewhere to deliver — provide
      // the legacy pixel id so the legacy synthesis yields one destination.
      if (where.key === 'tracking_meta_pixel_id')
        return Promise.resolve({ key: where.key, value: 'PIX-1' });
      return Promise.resolve(null);
    });
    config.set('GA_MEASUREMENT_ID', '');
    config.set('GA_API_SECRET', '');
    config.set('GA_ADS_CONVERSION_ID', '');

    const snap = await service.buildConfigSnapshot();

    expect(snap.enabledProviders).toEqual(['meta']);
    expect(snap.normalizerVersion).toBe(new TrackingNormalizer().version);
    expect(snap.capturedAt).toEqual(expect.any(String));
    // absent settings fall back to defaults
    expect(snap.purchaseModes).toEqual({ meta: 'instant', tiktok: 'instant' });
    expect(snap.validatedStatuses).toEqual({ meta: '', tiktok: '' });
  });

  it('buildConfigSnapshot records env-configured ga4/google_ads and resolved policy', async () => {
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_meta_validated_status'
        ? Promise.resolve({ key: where.key, value: 'Confirmed' })
        : Promise.resolve(null),
    );
    config.set('GA_MEASUREMENT_ID', 'G-XXXX');
    config.set('GA_API_SECRET', 'SECRET');
    config.set('GA_ADS_CONVERSION_ID', 'AW-123');

    const snap = await service.buildConfigSnapshot();

    expect(snap.enabledProviders).toContain('ga4');
    expect(snap.enabledProviders).toContain('google_ads');
    expect((snap.validatedStatuses as any).meta).toBe('Confirmed');
    expect(snap.enabledProviders).not.toContain('meta');
  });
});
