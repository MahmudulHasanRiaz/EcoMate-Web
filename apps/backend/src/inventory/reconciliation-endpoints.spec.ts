import { BadRequestException } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { getAllPermissions } from '../common/permissions/registry';

/**
 * S3 endpoint + Apply endpoint contract (2026-10-30 directive §2.3/§2.8):
 * the old heal-on-POST is gone — /inventory/reconcile is a read-only
 * report guarded by run_stock_reconciliation (a key that must actually
 * be grantable, not a maintain_media repeat), and /apply refuses without
 * backupId + confirmed and records the actor from the auth token.
 */

function makeController() {
  const inventoryService: any = {};
  const finder: any = {
    buildReport: jest.fn(async () => ({ rows: [], counts: {}, checks: [] })),
  };
  const apply: any = {
    apply: jest.fn(async () => ({ runId: 'run-1', applied: [], skipped: [] })),
  };
  const prisma: any = {};
  const controller = new InventoryController(
    inventoryService,
    finder,
    apply,
    prisma,
  );
  return { controller, finder, apply };
}

describe('InventoryController reconciliation endpoints', () => {
  it('report endpoint returns the finder report and writes nothing', async () => {
    const { controller, finder, apply } = makeController();
    const out = await controller.reconcile({ email: 'boss@example.com' } as any);
    expect(out).toEqual({ rows: [], counts: {}, checks: [] });
    expect(finder.buildReport).toHaveBeenCalledTimes(1);
    expect(apply.apply).not.toHaveBeenCalled();
  });

  it('both endpoints are guarded by run_stock_reconciliation', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, InventoryController.prototype.reconcile),
    ).toEqual(['run_stock_reconciliation']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        InventoryController.prototype.reconcileApply,
      ),
    ).toEqual(['run_stock_reconciliation']);
  });

  it('run_stock_reconciliation is grantable via getAllPermissions (no maintain_media repeat)', () => {
    expect(getAllPermissions()).toContain('run_stock_reconciliation');
  });

  it('apply refuses without confirmed=true', async () => {
    const { controller, apply } = makeController();
    await expect(
      controller.reconcileApply(
        { backupId: 'dump-1', rowIds: [], confirmed: false } as any,
        { email: 'boss@example.com' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(apply.apply).not.toHaveBeenCalled();
  });

  it('apply refuses without a backupId', async () => {
    const { controller, apply } = makeController();
    await expect(
      controller.reconcileApply(
        { backupId: '  ', rowIds: [], confirmed: true } as any,
        { email: 'boss@example.com' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(apply.apply).not.toHaveBeenCalled();
  });

  it('apply records the actor from the auth token, never from the body', async () => {
    const { controller, apply } = makeController();
    await controller.reconcileApply(
      {
        backupId: 'dump-1',
        rowIds: ['R1|x'],
        confirmed: true,
        performedBy: 'attacker@evil.example',
      } as any,
      { email: 'boss@example.com' } as any,
    );
    expect(apply.apply).toHaveBeenCalledWith({
      performedBy: 'boss@example.com',
      backupId: 'dump-1',
      rowIds: ['R1|x'],
    });
  });
});
