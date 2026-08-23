import { computeEffectivePermissions } from './effective-permissions';
import { getAllPermissions, PERMISSIONS } from './registry';

describe('computeEffectivePermissions', () => {
  const allKeys = getAllPermissions();
  const uniqueAll = [...new Set(allKeys)];

  it('admin role → all registered permission keys', () => {
    const perms = computeEffectivePermissions({
      role: 'admin',
      overridePermissions: [],
    });
    expect(perms).toEqual(uniqueAll);
    expect(perms).toContain('view_orders');
  });

  it('superadmin role → all registered permission keys', () => {
    const perms = computeEffectivePermissions({ role: 'superadmin' });
    expect(perms).toEqual(uniqueAll);
  });

  it('manager with employeeLink + accessPreset → preset permissions', () => {
    const presetPerms = ['view_orders', 'create_orders'];
    const perms = computeEffectivePermissions({
      role: 'manager',
      employeeLink: { accessPreset: { permissions: presetPerms } },
    });
    expect(perms).toEqual(presetPerms);
  });

  it('manager without employeeLink → []', () => {
    const perms = computeEffectivePermissions({ role: 'manager' });
    expect(perms).toEqual([]);
  });

  it('employee with preset + override → union, deduplicated, deterministic order, unknown override keys stripped', () => {
    const presetPerms = ['view_orders', 'view_products'];
    const override = ['view_products', 'view_customers', 'view_hr_not_real'];
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPreset: { permissions: presetPerms } },
      overridePermissions: override,
    });
    expect(perms).toEqual(['view_orders', 'view_products', 'view_customers']);
    expect(perms).not.toContain('view_hr_not_real');
  });

  it('customer role → [] even with employeeLink present (customer role is not staff-linked)', () => {
    const perms = computeEffectivePermissions({
      role: 'customer',
      employeeLink: { accessPreset: { permissions: ['view_orders'] } },
      overridePermissions: ['view_orders'],
    });
    expect(perms).toEqual([]);
  });

  it('override only (no preset) → override keys', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPreset: null },
      overridePermissions: ['edit_products', 'manage_stock'],
    });
    expect(perms).toEqual(['edit_products', 'manage_stock']);
  });

  it('unknown permission keys in preset are stripped at calc time', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPreset: { permissions: ['view_orders', 'not_a_real_key'] },
      },
    });
    expect(perms).toEqual(['view_orders']);
  });

  it('BA-equivalence: admin/superadmin supersede override-only narrowing (old logic gave override; approved semantics gives ALL keys)', () => {
    const perms = computeEffectivePermissions({
      role: 'superadmin',
      overridePermissions: ['view_orders'],
    });
    expect(perms).toEqual(uniqueAll);
  });

  it('deterministic order: preset keys always precede override keys', () => {
    const permsA = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPreset: { permissions: ['view_orders'] } },
      overridePermissions: ['manage_stock', 'view_orders'],
    });
    const permsB = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPreset: { permissions: ['view_orders'] } },
      overridePermissions: ['manage_stock', 'view_orders'],
    });
    expect(permsA).toEqual(permsB);
    expect(permsA).toEqual(['view_orders', 'manage_stock']);
  });

  it('undefined employeeLink.accessPreset (null preset id) → [] when no override', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPreset: null },
    });
    expect(perms).toEqual([]);
  });

  it('all registered PERMISSIONS keys are covered by the all-keys list', () => {
    Object.values(PERMISSIONS)
      .flat()
      .forEach((key) => expect(allKeys).toContain(key));
  });
});