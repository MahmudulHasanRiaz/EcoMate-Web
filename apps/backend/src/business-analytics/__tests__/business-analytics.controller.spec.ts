/**
 * P2 data-layer tests — business-analytics controller RBAC (§6 security).
 *
 * Class @RequiresFeature('admin_analytics') + @Roles(...). PermissionsGuard
 * uses getAllAndOverride([handler, class]) so handler metadata REPLACES class
 * metadata: financial handlers declare the FULL requirement (view_analytics
 * AND view_financial_summary) explicitly; general handlers declare
 * view_analytics explicitly. Asserted behaviourally through the real
 * PermissionsGuard.
 */
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BusinessAnalyticsController } from '../business-analytics.controller';

const FINANCIAL = ['pnl', 'expenses', 'fulfillment', 'reconciliation', 'overview', 'products', 'productDetail', 'uncostedProducts'];
const GENERAL = ['lenses'];

function contextFor(
  user: any,
  handler: (...args: any[]) => any,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => BusinessAnalyticsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('BusinessAnalyticsController RBAC', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsGuard, Reflector],
    }).compile();
    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
  });

  it('gates the whole controller on admin_analytics with staff roles', () => {
    const proto = BusinessAnalyticsController.prototype;
    for (const name of [...FINANCIAL, ...GENERAL]) {
      expect(typeof (proto as any)[name]).toBe('function');
    }
    const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      proto.pnl,
      BusinessAnalyticsController,
    ]);
    expect(roles).toEqual(
      expect.arrayContaining(['superadmin', 'admin', 'manager']),
    );
    const feature = reflector.getAllAndOverride<string>(
      'requires_feature',
      [proto.pnl, BusinessAnalyticsController],
    );
    expect(feature).toBe('admin_analytics');
  });

  it.each(FINANCIAL)('financial handler %s requires the full grant', (name) => {
    const handler = (BusinessAnalyticsController.prototype as any)[name];
    const perms = reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      handler,
      BusinessAnalyticsController,
    ]);
    expect(perms).toContain('view_analytics');
    expect(perms).toContain('view_financial_summary');
  });

  it.each(GENERAL)('general handler %s requires view_analytics', (name) => {
    const handler = (BusinessAnalyticsController.prototype as any)[name];
    const perms = reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      handler,
      BusinessAnalyticsController,
    ]);
    expect(perms).toContain('view_analytics');
    expect(perms).not.toContain('view_financial_summary');
  });

  it('denies a manager without view_financial_summary on financial handlers', () => {
    const user = { permissions: ['view_analytics'] };
    for (const name of FINANCIAL) {
      const handler = (BusinessAnalyticsController.prototype as any)[name];
      expect(() => guard.canActivate(contextFor(user, handler))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('denies a holder of view_financial_summary without view_analytics', () => {
    const user = { permissions: ['view_financial_summary'] };
    for (const name of FINANCIAL) {
      const handler = (BusinessAnalyticsController.prototype as any)[name];
      expect(() => guard.canActivate(contextFor(user, handler))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('allows financial handlers with the full grant', () => {
    const user = { permissions: ['view_analytics', 'view_financial_summary'] };
    for (const name of FINANCIAL) {
      const handler = (BusinessAnalyticsController.prototype as any)[name];
      expect(guard.canActivate(contextFor(user, handler))).toBe(true);
    }
  });

  it('allows the general handler with view_analytics only', () => {
    const user = { permissions: ['view_analytics'] };
    const handler = (BusinessAnalyticsController.prototype as any).lenses;
    expect(guard.canActivate(contextFor(user, handler))).toBe(true);
  });
});
