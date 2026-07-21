import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { OrdersController } from '../orders/orders.controller';
import { UsersController } from '../users/users.controller';
import { DispatchController } from '../dispatch/dispatch.controller';
import { WarehousesController } from '../warehouses/warehouses.controller';
import { BrandsController } from '../brands/brands.controller';
import { CouponsController } from '../coupons/coupons.controller';
import { OrderStatusController } from '../orders/order-status.controller';
import { TasksController } from '../tasks/tasks.controller';

/**
 * Unit-level guard tests.
 * Use Reflect.getMetadata to verify that @Roles() decorator metadata
 * is attached to the correct route handlers.
 *
 * Before the fix: no metadata → Reflect.getMetadata returns undefined → test fails.
 * After the fix: metadata present with correct roles → test passes.
 */

function getRoles(target: any, propertyKey: string): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, target.prototype[propertyKey]);
}

function getHandler(controller: any, methodName: string): any {
  return controller.prototype[methodName];
}

/* ── OrdersController ── */

describe('OrdersController role guards', () => {
  it('GET /orders requires superadmin/admin/manager', () => {
    const roles = getRoles(OrdersController, 'findAll');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('manager');
  });

  it('POST /orders/:id/verify-payment requires superadmin/admin/manager', () => {
    const roles = getRoles(OrdersController, 'verifyPayment');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('manager');
  });

  // Owner-accessible routes must NOT have roles:
  it('GET /orders/my has NO @Roles() (customer-owned)', () => {
    const roles = getRoles(OrdersController, 'findMyOrders');
    expect(roles).toBeUndefined();
  });

  it('POST /orders (create) is @Public() — no roles', () => {
    const roles = getRoles(OrdersController, 'create');
    expect(roles).toBeUndefined();
  });
});

/* ── UsersController ── */

describe('UsersController role guards', () => {
  it('GET /users requires superadmin/admin', () => {
    const roles = getRoles(UsersController, 'findAll');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  it('GET /users/by-email/:email requires superadmin/admin', () => {
    const roles = getRoles(UsersController, 'findByEmail');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  it('GET /users/:id requires superadmin/admin', () => {
    const roles = getRoles(UsersController, 'findOne');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  // Settings endpoints are user-scoped, NOT role-restricted:
  it('GET /users/settings has NO @Roles() (owner-scoped)', () => {
    const roles = getRoles(UsersController, 'getSettings');
    expect(roles).toBeUndefined();
  });
});

/* ── DispatchController ── */

describe('DispatchController role guards', () => {
  const endpointMethods = [
    'findAll',
    'getMetrics',
    'findFlagged',
    'resolveFlagged',
    'findOne',
    'create',
    'updateStatus',
  ] as const;

  for (const method of endpointMethods) {
    it(`${method} requires superadmin/admin/manager`, () => {
      const roles = getRoles(DispatchController, method);
      expect(roles).toBeDefined();
      expect(roles).toContain('superadmin');
      expect(roles).toContain('admin');
      expect(roles).toContain('manager');
    });
  }

  // DELETE already had @Roles('superadmin', 'admin'), verify unchanged:
  it('DELETE /dispatch/:id requires superadmin/admin (already existed)', () => {
    const roles = getRoles(DispatchController, 'remove');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });
});

/* ── WarehousesController ── */

describe('WarehousesController role guards', () => {
  const readMethods = [
    'findAll',
    'findAllBinLocations',
    'findOne',
    'listBinLocations',
    'listZones',
    'listRacks',
    'listShelves',
  ] as const;

  for (const method of readMethods) {
    it(`${method} requires superadmin/admin/manager/cashier (read endpoint)`, () => {
      const roles = getRoles(WarehousesController, method);
      expect(roles).toBeDefined();
      expect(roles).toContain('superadmin');
      expect(roles).toContain('admin');
      expect(roles).toContain('manager');
      expect(roles).toContain('cashier');
    });
  }

  // Write endpoints already had roles — verify they didn't regress:
  it('POST /warehouses requires superadmin/admin', () => {
    const roles = getRoles(WarehousesController, 'create');
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  it('POST /warehouses/:id/bin-locations requires superadmin/admin/manager', () => {
    const roles = getRoles(WarehousesController, 'createBinLocation');
    expect(roles).toEqual(['superadmin', 'admin', 'manager']);
  });
});

/* ── BrandsController ── */

describe('BrandsController role guards', () => {
  it('POST /brands requires superadmin/admin', () => {
    const roles = getRoles(BrandsController, 'create');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  it('PUT /brands/:id requires superadmin/admin', () => {
    const roles = getRoles(BrandsController, 'update');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  it('DELETE /brands/:id requires superadmin/admin', () => {
    const roles = getRoles(BrandsController, 'remove');
    expect(roles).toBeDefined();
    expect(roles).toEqual(['superadmin', 'admin']);
  });

  // Public reads must stay public:
  it('GET /brands has NO @Roles() (public read)', () => {
    const roles = getRoles(BrandsController, 'findAll');
    expect(roles).toBeUndefined();
  });
});

/* ── CouponsController ── */

describe('CouponsController role guards', () => {
  it('GET /coupons requires superadmin/admin/manager', () => {
    const roles = getRoles(CouponsController, 'findAll');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('manager');
  });

  // Validate endpoint is used by storefront — no roles:
  it('GET /coupons/validate has NO @Roles() (storefront uses it)', () => {
    const roles = getRoles(CouponsController, 'validate');
    expect(roles).toBeUndefined();
  });
});

/* ── OrderStatusController ── */

describe('OrderStatusController role guards', () => {
  it('GET /order-statuses requires superadmin/admin/manager', () => {
    const roles = getRoles(OrderStatusController, 'findAll');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('manager');
  });
});

/* ── TasksController ── */

describe('TasksController role guards', () => {
  it('GET /tasks requires superadmin/admin/manager', () => {
    const roles = getRoles(TasksController, 'findAll');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('manager');
  });

  it('GET /tasks/:id requires superadmin/admin/manager', () => {
    const roles = getRoles(TasksController, 'findOne');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('manager');
  });
});
