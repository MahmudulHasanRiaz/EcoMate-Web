import { ForbiddenException } from '@nestjs/common';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SystemSettingsController } from '../system-settings.controller';

describe('SystemSettingsController', () => {
  it('adds RequiresFeature(admin_settings) on getAll', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getAll,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getStorageConfig', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getStorageConfig,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on set', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.set,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getSmtpSettings', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getSmtpSettings,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on updateSmtpSettings', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.updateSmtpSettings,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on testSmtp', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.testSmtp,
    );
    expect(meta).toBe('admin_settings');
  });

  it('does not add RequiresFeature on public getPublicBranding', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getPublicBranding,
    );
    expect(meta).toBeUndefined();
  });

  it('does not add RequiresFeature on public getStorefrontConfig', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getStorefrontConfig,
    );
    expect(meta).toBeUndefined();
  });

  describe('getStorefrontConfig blocked-phone message', () => {
    function mockController(
      settings: { key: string; value: string }[] = [],
    ) {
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

    it('falls back to the default message when no key is configured', async () => {
      const cfg = await mockController().getStorefrontConfig();
      expect(cfg.order.blockedPhoneMessage).toBe(
        'This phone number has been blocked. Please contact support.',
      );
    });

    it('uses the configured blocked_phone_message value', async () => {
      const ctrl = mockController([
        { key: 'blocked_phone_message', value: 'Your number is on hold. Call us.' },
      ]);
      const cfg = await ctrl.getStorefrontConfig();
      expect(cfg.order.blockedPhoneMessage).toBe(
        'Your number is on hold. Call us.',
      );
    });
  });

  describe('POST :key payments.* admin-only guard', () => {
    function mockSetController() {
      const prisma = {
        systemSetting: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest
            .fn()
            .mockImplementation(async ({ create }: any) => create),
        },
      };
      const cache = { delete: jest.fn().mockResolvedValue(undefined) };
      const ctrl = new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        cache as any,
        {} as any,
      );
      return { ctrl, prisma, cache };
    }

    it.each(['payments.editAllowed', 'payments.staffAutoVerified'])(
      'employee write to %s → 403',
      async (key) => {
        const { ctrl, prisma } = mockSetController();
        await expect(
          ctrl.set(key, { value: 'true' }, { role: 'employee' } as any),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
      },
    );

    it('anonymous/roleless write to payments.* → 403 (fail-closed)', async () => {
      const { ctrl, prisma } = mockSetController();
      await expect(
        ctrl.set('payments.editAllowed', { value: 'true' }, undefined),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it.each([{ role: 'admin' }, { role: 'superadmin' }])(
      'admin write to payments.editAllowed → ok ($role)',
      async (user) => {
        const { ctrl, prisma } = mockSetController();
        const res = await ctrl.set(
          'payments.editAllowed',
          { value: 'true' },
          user as any,
        );
        expect(res).toEqual({ key: 'payments.editAllowed', value: 'true' });
        expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
          where: { key: 'payments.editAllowed' },
          create: { key: 'payments.editAllowed', value: 'true' },
          update: { value: 'true' },
        });
      },
    );

    it('employee write to a non-payments key → ok (authz unchanged)', async () => {
      const { ctrl, prisma } = mockSetController();
      const res = await ctrl.set(
        'store_name',
        { value: 'EcoMate' },
        { role: 'employee' } as any,
      );
      expect(res).toEqual({ key: 'store_name', value: 'EcoMate' });
      expect(prisma.systemSetting.upsert).toHaveBeenCalled();
    });
  });
});
