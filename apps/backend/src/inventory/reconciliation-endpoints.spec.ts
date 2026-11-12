import { BadRequestException } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
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
  const q8Settle: any = { settle: jest.fn(async () => ({})) };
  const fixAll: any = {
    fixAll: jest.fn(async () => ({
      backupId: 'bk-1',
      apply: { runId: 'run-1', applied: [], skipped: [], idempotency: {} },
      settle: { ran: false, reason: 'x' },
      postReport: { counts: {}, checks: [] },
      generatedAt: new Date().toISOString(),
    })),
  };
  const controller = new InventoryController(
    inventoryService,
    finder,
    apply,
    prisma,
    q8Settle,
    fixAll,
  );
  return { controller, finder, apply, q8Settle, fixAll };
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

  it('both endpoints also carry the staff role gate', () => {
    // The permission alone left the role layer unset (2026-11-03): every
    // other inventory route pairs @Permissions with the staff @Roles set.
    expect(
      Reflect.getMetadata(ROLES_KEY, InventoryController.prototype.reconcile),
    ).toEqual(['superadmin', 'admin', 'employee']);
    expect(
      Reflect.getMetadata(ROLES_KEY, InventoryController.prototype.reconcileApply),
    ).toEqual(['superadmin', 'admin', 'employee']);
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
      // WS3: the controller now forwards the body's confirmed flag so the
      // service can enforce it in depth (it used to stop at the controller).
      confirmed: true,
      rowIds: ['R1|x'],
    });
  });

  // One-click fix-all (2026-11-12, recon simplification round): same
  // guard as apply, refuses without confirmed=true, records the actor
  // from the token, and passes isSuperAdmin through from user.role
  // (the Q8 settle runs only for superadmins, inside the service).

  it('fix-all carries the same @Permissions/@Roles as apply', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        InventoryController.prototype.reconcileFixAll,
      ),
    ).toEqual(['run_stock_reconciliation']);
    expect(
      Reflect.getMetadata(ROLES_KEY, InventoryController.prototype.reconcileFixAll),
    ).toEqual(['superadmin', 'admin', 'employee']);
  });

  it('fix-all refuses without confirmed=true', async () => {
    const { controller, fixAll } = makeController();
    await expect(
      controller.reconcileFixAll(
        { confirmed: false } as any,
        { email: 'boss@example.com', role: 'superadmin' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixAll.fixAll).not.toHaveBeenCalled();
  });

  it('fix-all records the actor from the token and passes isSuperAdmin=true for superadmin', async () => {
    const { controller, fixAll } = makeController();
    await controller.reconcileFixAll(
      { confirmed: true, performedBy: 'attacker@evil.example' } as any,
      { email: 'boss@example.com', role: 'superadmin' } as any,
    );
    expect(fixAll.fixAll).toHaveBeenCalledWith({
      performedBy: 'boss@example.com',
      isSuperAdmin: true,
      confirmed: true,
    });
  });

  it('fix-all passes isSuperAdmin=false for admin/employee (settle skipped inside the service)', async () => {
    const { controller, fixAll } = makeController();
    await controller.reconcileFixAll(
      { confirmed: true } as any,
      { email: 'staff@example.com', role: 'admin' } as any,
    );
    expect(fixAll.fixAll).toHaveBeenCalledWith({
      performedBy: 'staff@example.com',
      isSuperAdmin: false,
      confirmed: true,
    });
    await controller.reconcileFixAll(
      { confirmed: true } as any,
      { email: 'emp@example.com', role: 'employee' } as any,
    );
    expect(fixAll.fixAll).toHaveBeenLastCalledWith({
      performedBy: 'emp@example.com',
      isSuperAdmin: false,
      confirmed: true,
    });
  });
});
