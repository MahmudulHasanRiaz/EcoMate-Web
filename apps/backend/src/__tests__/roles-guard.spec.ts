import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
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

function getPermissions(target: any, propertyKey: string): string[] | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, target.prototype[propertyKey]);
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
    expect(roles).toContain('employee');
  });

  it('POST /orders/:id/verify-payment requires superadmin/admin/manager', () => {
    const roles = getRoles(OrdersController, 'verifyPayment');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('employee');
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

describe('UsersController permission guards (preset supremacy 2026-10-24)', () => {
  it('GET /users requires view_users and has NO role gate', () => {
    expect(getRoles(UsersController, 'findAll')).toBeUndefined();
    expect(getPermissions(UsersController, 'findAll')).toEqual(['view_users']);
  });

  it('GET /users/by-email/:email requires view_users and has NO role gate', () => {
    expect(getRoles(UsersController, 'findByEmail')).toBeUndefined();
    expect(getPermissions(UsersController, 'findByEmail')).toEqual(['view_users']);
  });

  it('GET /users/:id requires view_users and has NO role gate', () => {
    expect(getRoles(UsersController, 'findOne')).toBeUndefined();
    expect(getPermissions(UsersController, 'findOne')).toEqual(['view_users']);
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
      expect(roles).toContain('employee');
    });
  }

  // DELETE was @Roles('superadmin','admin'); preset supremacy moved it to the
  // dispatch capability key (a preset holder with it may remove a dispatch).
  it('DELETE /dispatch/:id requires manage_dispatch_dispatch and has NO role gate', () => {
    expect(getRoles(DispatchController, 'remove')).toBeUndefined();
    expect(getPermissions(DispatchController, 'remove')).toEqual(['manage_dispatch_dispatch']);
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
      expect(roles).toContain('employee');
      expect(roles).toContain('cashier');
    });
  }

  // Write endpoints moved from @Roles('superadmin','admin') to the
  // warehouses capability keys (preset supremacy 2026-10-24):
  it('POST /warehouses requires create_warehouses and has NO role gate', () => {
    expect(getRoles(WarehousesController, 'create')).toBeUndefined();
    expect(getPermissions(WarehousesController, 'create')).toEqual(['create_warehouses']);
  });

  it('PUT /warehouses/:id requires edit_warehouses and has NO role gate', () => {
    expect(getRoles(WarehousesController, 'update')).toBeUndefined();
    expect(getPermissions(WarehousesController, 'update')).toEqual(['edit_warehouses']);
  });

  it('DELETE /warehouses/:id requires delete_warehouses and has NO role gate', () => {
    expect(getRoles(WarehousesController, 'remove')).toBeUndefined();
    expect(getPermissions(WarehousesController, 'remove')).toEqual(['delete_warehouses']);
  });

  it('POST /warehouses/:id/bin-locations requires superadmin/admin/manager', () => {
    const roles = getRoles(WarehousesController, 'createBinLocation');
    expect(roles).toEqual(['superadmin', 'admin', 'employee']);
  });
});

/* ── BrandsController ── */

describe('BrandsController permission guards (preset supremacy 2026-10-24)', () => {
  it('POST /brands requires create_brands and has NO role gate', () => {
    expect(getRoles(BrandsController, 'create')).toBeUndefined();
    expect(getPermissions(BrandsController, 'create')).toEqual(['create_brands']);
  });

  it('PUT /brands/:id requires edit_brands and has NO role gate', () => {
    expect(getRoles(BrandsController, 'update')).toBeUndefined();
    expect(getPermissions(BrandsController, 'update')).toEqual(['edit_brands']);
  });

  it('DELETE /brands/:id requires delete_brands and has NO role gate', () => {
    expect(getRoles(BrandsController, 'remove')).toBeUndefined();
    expect(getPermissions(BrandsController, 'remove')).toEqual(['delete_brands']);
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
    expect(roles).toContain('employee');
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
    expect(roles).toContain('employee');
  });
});

/* ── TasksController ── */

describe('TasksController role guards', () => {
  it('GET /tasks requires superadmin/admin/manager', () => {
    const roles = getRoles(TasksController, 'findAll');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('employee');
  });

  it('GET /tasks/:id requires superadmin/admin/manager', () => {
    const roles = getRoles(TasksController, 'findOne');
    expect(roles).toBeDefined();
    expect(roles).toContain('superadmin');
    expect(roles).toContain('admin');
    expect(roles).toContain('employee');
  });
});
