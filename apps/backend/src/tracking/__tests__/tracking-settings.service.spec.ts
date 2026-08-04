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
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_meta_enabled'
        ? Promise.resolve({ key: where.key, value: 'true' })
        : Promise.resolve(null),
    );
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
