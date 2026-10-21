import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readPaymentSettings } from '../payments/payment-settings';

/**
 * Who may record a refund (owner decision, 2026-10-21).
 *
 * THE GATE THIS REPLACES: the refund endpoints were guarded by the static
 * `@Permissions('approve_payments')`. The ROLE decorator already allowed
 * employees, but the permission check did not — staff managed through User
 * Management (not the HR module) do not hold `approve_payments`, so every
 * cancel-with-refund died with "Insufficient permissions" and the whole
 * cancel looked broken.
 *
 * NEW CONTRACT (Payment Settings → "Staff can process refunds",
 * `payments.staffRefundsAllowed`, DEFAULT ON):
 *  - admin/superadmin: always allowed.
 *  - staff + the setting ON: allowed when the staff member holds one of the
 *    normal order/payment permissions (below) — the same permissions that let
 *    them work the orders/payments they are already trusted with.
 *  - staff + the setting OFF: refused with a clear message. The CANCEL itself
 *    is never blocked by this gate: the order status change is a separate
 *    endpoint and stays available.
 */
export const STAFF_REFUND_PERMISSIONS = [
  'approve_payments',
  'create_refunds',
  'edit_refunds',
  'refund_orders',
  'change_status_orders',
  'edit_orders',
];

@Injectable()
export class RefundPermissionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | { role?: string; permissions?: string[] }
      | undefined;

    if (!user) {
      throw new ForbiddenException('Sign in to record a refund.');
    }

    const role = user.role;
    if (role === 'superadmin' || role === 'admin') return true;

    const settings = await readPaymentSettings(this.prisma);
    if (!settings.staffRefundsAllowed) {
      throw new ForbiddenException(
        'Refunds are restricted to administrators — ask an admin to record this refund. ' +
          'The order can still be cancelled without a refund record.',
      );
    }

    const permissions = user.permissions ?? [];
    if (!permissions.some((p) => STAFF_REFUND_PERMISSIONS.includes(p))) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
