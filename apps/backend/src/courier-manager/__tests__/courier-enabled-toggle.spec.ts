import { validate } from 'class-validator';
import { CourierManagerController } from '../courier-manager.controller';
import { UpdateCourierEnabledDto } from '../dto/update-courier-enabled.dto';

/**
 * Queue burn-down D1: the settings card's enable switch must persist on its
 * own. These tests pin that the dedicated route writes ONLY `enabled` (never
 * touching credential columns or the legacy `credentials` JSON) and that a
 * failed write is surfaced instead of being reported as success.
 */
const createController = () => {
  const prisma = {
    courierCredentials: {
      update: jest.fn(),
    },
  };
  const controller = new CourierManagerController(
    {} as any,
    {} as any,
    prisma as any,
    {} as any,
    {} as any,
  );
  return { controller, prisma };
};

describe('CourierManagerController — PATCH credentials/:courier/enabled', () => {
  it('writes only the enabled flag (no credential columns, no credentials reset)', async () => {
    const { controller, prisma } = createController();
    prisma.courierCredentials.update.mockResolvedValue({
      courier: 'steadfast',
      enabled: true,
    });

    await controller.setCourierEnabled('steadfast', { enabled: true });

    expect(prisma.courierCredentials.update).toHaveBeenCalledTimes(1);
    expect(prisma.courierCredentials.update).toHaveBeenCalledWith({
      where: { courier: 'steadfast' },
      data: { enabled: true },
      // Narrow select: no apiKey/secretKey/webhookSecret can leak back.
      select: { courier: true, enabled: true },
    });
  });

  it('persists disabling as well', async () => {
    const { controller, prisma } = createController();
    prisma.courierCredentials.update.mockResolvedValue({
      courier: 'pathao',
      enabled: false,
    });

    await controller.setCourierEnabled('pathao', { enabled: false });

    expect(prisma.courierCredentials.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { enabled: false } }),
    );
  });

  it('returns the persisted row instead of a hardcoded success payload', async () => {
    const { controller, prisma } = createController();
    prisma.courierCredentials.update.mockResolvedValue({
      courier: 'redx',
      enabled: false,
    });

    await expect(
      controller.setCourierEnabled('redx', { enabled: true }),
    ).resolves.toEqual({ courier: 'redx', enabled: false });
  });

  it('propagates a failed write (no false success)', async () => {
    const { controller, prisma } = createController();
    prisma.courierCredentials.update.mockRejectedValue(
      Object.assign(new Error('Record to update not found.'), {
        code: 'P2025',
      }),
    );

    await expect(
      controller.setCourierEnabled('carrybee', { enabled: true }),
    ).rejects.toThrow('Record to update not found.');
  });

  it('rejects a non-boolean body via the DTO contract', async () => {
    const asString = Object.assign(new UpdateCourierEnabledDto(), {
      enabled: 'true',
    });
    const asMissing = new UpdateCourierEnabledDto();

    expect(await validate(asString)).not.toHaveLength(0);
    expect(await validate(asMissing)).not.toHaveLength(0);
    expect(
      await validate(Object.assign(new UpdateCourierEnabledDto(), {
        enabled: true,
      })),
    ).toHaveLength(0);
  });
});
