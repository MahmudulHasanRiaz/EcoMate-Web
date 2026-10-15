import { Test, TestingModule } from '@nestjs/testing';
import { CourierManagerController } from '../courier-manager.controller';
import { SteadfastCredentialSetsService } from '../steadfast-credential-sets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption';

/**
 * Return/Exchange hardening (5a): ROBUSTNESS — credential sets.
 *
 * GET /couriers/credential-sets with zero sets, a missing model, a failing
 * query, or an unwired provider returns [] — never an unhandled 500.
 *
 * RED phase: the missing-model / failing-query paths throw today.
 */
describe('credential-sets robustness (hardening 5a)', () => {
  const encryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => String(v).replace(/^enc:/, '')),
  };

  async function serviceWith(prisma: any) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SteadfastCredentialSetsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();
    return module.get<SteadfastCredentialSetsService>(SteadfastCredentialSetsService);
  }

  it('zero configured sets → []', async () => {
    const svc = await serviceWith({
      courierCredentialSet: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(svc.listSets()).resolves.toEqual([]);
  });

  it('missing model (unavailable sets) → [] instead of a 500 TypeError', async () => {
    const svc = await serviceWith({});
    await expect(svc.listSets()).resolves.toEqual([]);
  });

  it('failing query → [] instead of an unhandled 500', async () => {
    const svc = await serviceWith({
      courierCredentialSet: {
        findMany: jest.fn().mockRejectedValue(new Error('db down')),
      },
    });
    await expect(svc.listSets()).resolves.toEqual([]);
  });

  it('controller with no sets provider wired → [] instead of throwing', async () => {
    const controller = new CourierManagerController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
    );
    await expect(controller.listCredentialSets()).resolves.toEqual([]);
  });
});
