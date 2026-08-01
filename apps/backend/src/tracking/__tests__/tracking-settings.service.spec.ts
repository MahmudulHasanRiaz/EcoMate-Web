import { ConfigService } from '@nestjs/config';
import { TrackingSettingsService } from '../tracking-settings.service';

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
});
