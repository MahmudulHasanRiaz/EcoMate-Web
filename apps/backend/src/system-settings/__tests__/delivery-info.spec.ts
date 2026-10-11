import { SystemSettingsController } from '../system-settings.controller';

describe('getStorefrontConfig deliveryInfo', () => {
  function mockController(settings: { key: string; value: string }[] = []) {
    const prisma = {
      systemSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      shippingOption: { findMany: jest.fn().mockResolvedValue([]) },
      shippingZoneGroup: { findMany: jest.fn().mockResolvedValue([]) },
      paymentOption: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      getStale: jest.fn(),
      set: jest.fn(),
    };
    return new SystemSettingsController(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      {} as any,
    );
  }

  it('returns default rows enabled when no keys are configured', async () => {
    const cfg = await mockController().getStorefrontConfig();
    expect(cfg.deliveryInfo).toEqual({
      enabled: true,
      title: '',
      rows: [
        { label: 'Inside Dhaka', value: '1–2 business days' },
        { label: 'Outside Dhaka', value: '3–5 business days' },
        { label: 'Payment', value: 'Cash on Delivery' },
      ],
    });
  });

  it('returns configured title/rows and honors disabled', async () => {
    const cfg = await mockController([
      { key: 'delivery_info_enabled', value: 'false' },
      { key: 'delivery_info_title', value: 'Delivery' },
      {
        key: 'delivery_info_rows',
        value: JSON.stringify([{ label: 'Dhaka', value: 'Same day' }]),
      },
    ]).getStorefrontConfig();
    expect(cfg.deliveryInfo).toEqual({
      enabled: false,
      title: 'Delivery',
      rows: [{ label: 'Dhaka', value: 'Same day' }],
    });
  });

  it('hides the card when rows are explicitly emptied', async () => {
    const cfg = await mockController([
      { key: 'delivery_info_enabled', value: 'true' },
      { key: 'delivery_info_rows', value: '[]' },
    ]).getStorefrontConfig();
    expect(cfg.deliveryInfo.enabled).toBe(true);
    expect(cfg.deliveryInfo.rows).toEqual([]);
  });

  it('falls back to defaults on malformed rows JSON', async () => {
    const cfg = await mockController([
      { key: 'delivery_info_rows', value: 'not-json{{{' },
    ]).getStorefrontConfig();
    expect(cfg.deliveryInfo.rows).toHaveLength(3);
    expect(cfg.deliveryInfo.enabled).toBe(true);
  });
});
