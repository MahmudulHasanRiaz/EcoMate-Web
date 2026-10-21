import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import {
  RefundPermissionGuard,
  STAFF_REFUND_PERMISSIONS,
} from '../refund-permission.guard';
import { OrdersController } from '../../orders/orders.controller';

/**
 * Owner decision (2026-10-21): refund creation is not admin-only.
 *
 * THE GATE IT REPLACES: the refund endpoints required the static
 * `@Permissions('approve_payments')`. The role decorator already allowed
 * employees, but the permission did not — staff managed through User
 * Management (not HR) do not hold `approve_payments`, so every
 * cancel-with-refund failed with "Insufficient permissions" and the cancel
 * looked broken.
 *
 * NEW CONTRACT (Payment Settings → "Staff can process refunds",
 * `payments.staffRefundsAllowed`, DEFAULT ON):
 *  - admin/superadmin: always allowed;
 *  - staff + ON: allowed with one of the normal order/payment permissions;
 *  - staff + OFF: refused with a clear message — the CANCEL itself is never
 *    blocked by this gate (it is a different endpoint).
 */
describe('RefundPermissionGuard', () => {
  const makeCtx = (user: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const prismaWith = (rows: Array<{ key: string; value: string }>) =>
    ({
      systemSetting: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    }) as any;

  it('lets an ADMIN record a refund even when the staff toggle is OFF', async () => {
    const guard = new RefundPermissionGuard(
      prismaWith([{ key: 'payments.staffRefundsAllowed', value: 'false' }]),
    );
    await expect(
      guard.canActivate(makeCtx({ role: 'admin', permissions: [] })),
    ).resolves.toBe(true);
  });

  it('lets a SUPERADMIN record a refund even when the staff toggle is OFF', async () => {
    const guard = new RefundPermissionGuard(
      prismaWith([{ key: 'payments.staffRefundsAllowed', value: 'false' }]),
    );
    await expect(
      guard.canActivate(makeCtx({ role: 'superadmin', permissions: [] })),
    ).resolves.toBe(true);
  });

  it('DEFAULT (no setting row) lets STAFF record a refund with a normal order/payment permission', async () => {
    const guard = new RefundPermissionGuard(prismaWith([]));
    await expect(
      guard.canActivate(
        makeCtx({ role: 'employee', permissions: ['change_status_orders'] }),
      ),
    ).resolves.toBe(true);
  });

  it('lets STAFF record a refund when the toggle is ON (any of the staff refund permissions)', async () => {
    const guard = new RefundPermissionGuard(
      prismaWith([{ key: 'payments.staffRefundsAllowed', value: 'true' }]),
    );
    for (const permission of STAFF_REFUND_PERMISSIONS) {
      await expect(
        guard.canActivate(makeCtx({ role: 'employee', permissions: [permission] })),
      ).resolves.toBe(true);
    }
  });

  it('refuses STAFF with a clear message when the toggle is OFF', async () => {
    const guard = new RefundPermissionGuard(
      prismaWith([{ key: 'payments.staffRefundsAllowed', value: 'false' }]),
    );
    await expect(
      guard.canActivate(
        makeCtx({ role: 'employee', permissions: ['change_status_orders'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        makeCtx({ role: 'employee', permissions: ['change_status_orders'] }),
      ),
    ).rejects.toThrow(/restricted to administrators/i);
  });

  it('refuses a staff member without any order/payment permission (the old failure mode)', async () => {
    const guard = new RefundPermissionGuard(prismaWith([]));
    await expect(
      guard.canActivate(makeCtx({ role: 'employee', permissions: ['view_orders'] })),
    ).rejects.toThrow(/Insufficient permissions/);
  });

  it('never gates the ORDER cancel — the refund gate must not block a cancel without a refund', () => {
    // The order status change (→ Cancelled) is a different endpoint and
    // carries no refund guard: a staff member can still cancel an order
    // without recording a refund, whatever the refund toggle says.
    const guards = Reflect.getMetadata(
      '__guards__',
      OrdersController.prototype.updateStatus,
    ) as unknown[] | undefined;
    const names = (guards ?? []).map((g: any) => g?.name ?? g?.constructor?.name);
    expect(names).not.toContain('RefundPermissionGuard');
  });

  it('refuses an unauthenticated request', async () => {
    const guard = new RefundPermissionGuard(prismaWith([]));
    await expect(guard.canActivate(makeCtx(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
