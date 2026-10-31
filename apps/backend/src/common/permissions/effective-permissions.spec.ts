import { computeEffectivePermissions, sanitizePermissions } from './effective-permissions';
import { getAllPermissions, PERMISSIONS } from './registry';

describe('computeEffectivePermissions', () => {
  const allKeys = getAllPermissions();
  const uniqueAll = [...new Set(allKeys)];

  // Owner rule 2026-10-24: preset supreme. A linked preset is identified by
  // accessPresetId (not by a non-empty permission list — an intentionally
  // empty preset means no access, not "fall back to role").

  it('admin role with NO preset → all registered permission keys', () => {
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

  it('superadmin WITH a linked preset → still all (Q1: superadmin never restricted)', () => {
    const perms = computeEffectivePermissions({
      role: 'superadmin',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
    });
    expect(perms).toEqual(uniqueAll);
  });

  it('admin WITH a linked preset → preset only, NOT all (preset supremacy)', () => {
    const perms = computeEffectivePermissions({
      role: 'admin',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders', 'create_orders'] },
      },
    });
    expect(perms).toEqual(['view_orders', 'create_orders']);
  });

  it('admin with override-only (no linked preset) → all (judgment call: legacy admin overrides were no-op extras; only a linked preset restricts an admin)', () => {
    const perms = computeEffectivePermissions({
      role: 'admin',
      overridePermissions: ['view_orders'],
    });
    expect(perms).toEqual(uniqueAll);
  });

  it('employee with linked preset → preset permissions', () => {
    const presetPerms = ['view_orders', 'create_orders'];
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: presetPerms },
      },
    });
    expect(perms).toEqual(presetPerms);
  });

  it('employee with an intentionally EMPTY linked preset → [] (no role fallback)', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPresetId: 'preset-empty', accessPreset: { permissions: [] } },
    });
    expect(perms).toEqual([]);
  });

  it('employee without employeeLink → role defaults restored 2026-10-28 (NOT [])', () => {
    // Was [] before the client-compat fix. The @Permissions conversion took
    // these four keys from preset-less employees (they previously held them
    // through employee-inclusive gates); restoring exactly these four is
    // the auto-align fix. A linked preset — even an empty one — still wins
    // over these defaults (see the empty-preset test above).
    const perms = computeEffectivePermissions({ role: 'employee' });
    expect(perms).toEqual([
      'view_media',
      'view_customer_reviews',
      'approve_customer_reviews',
      'view_cod_mismatch',
    ]);
  });

  it('cashier without employeeLink → [] (lost nothing in the conversion)', () => {
    expect(computeEffectivePermissions({ role: 'cashier' })).toEqual([]);
  });

  it('packing_assistant without employeeLink → [] (lost nothing in the conversion)', () => {
    expect(
      computeEffectivePermissions({ role: 'packing_assistant' }),
    ).toEqual([]);
  });

  it('superadmin effective set includes maintain_media (2026-10-28 client-compat fix)', () => {
    const perms = computeEffectivePermissions({ role: 'superadmin' });
    expect(perms).toContain('maintain_media');
  });

  it('employee with a preset granting maintain_media keeps it (sanitize recognises the key)', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['maintain_media'] },
      },
    });
    expect(perms).toEqual(['maintain_media']);
  });

  it('employee with preset + override → union, deduplicated, deterministic order, unknown override keys stripped', () => {
    const presetPerms = ['view_orders', 'view_products'];
    const override = ['view_products', 'view_customers', 'view_hr_not_real'];
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: presetPerms },
      },
      overridePermissions: override,
    });
    expect(perms).toEqual(['view_orders', 'view_products', 'view_customers']);
    expect(perms).not.toContain('view_hr_not_real');
  });

  it('deniedPermissions remove preset keys (Q3: preset + custom decrease)', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders', 'create_orders', 'view_products'] },
      },
      deniedPermissions: ['create_orders'],
    });
    expect(perms).toEqual(['view_orders', 'view_products']);
  });

  it('deniedPermissions remove added keys too, and unknown denied keys are stripped', () => {
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
      overridePermissions: ['view_products', 'view_customers'],
      deniedPermissions: ['view_products', 'ghost_key'],
    });
    expect(perms).toEqual(['view_orders', 'view_customers']);
  });

  it('customer role → [] even with employeeLink present (customer role is not staff-linked)', () => {
    const perms = computeEffectivePermissions({
      role: 'customer',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
      overridePermissions: ['view_orders'],
    });
    expect(perms).toEqual([]);
  });

  it('override only (no preset) → override keys (Q2: custom behaves like a preset)', () => {
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
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders', 'not_a_real_key'] },
      },
    });
    expect(perms).toEqual(['view_orders']);
  });

  it('BA-equivalence: superadmin supersedes override-only narrowing (old logic gave override; approved semantics gives ALL keys)', () => {
    const perms = computeEffectivePermissions({
      role: 'superadmin',
      overridePermissions: ['view_orders'],
    });
    expect(perms).toEqual(uniqueAll);
  });

  it('deterministic order: preset keys always precede override keys', () => {
    const permsA = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
      overridePermissions: ['manage_stock', 'view_orders'],
    });
    const permsB = computeEffectivePermissions({
      role: 'employee',
      employeeLink: {
        accessPresetId: 'preset-1',
        accessPreset: { permissions: ['view_orders'] },
      },
      overridePermissions: ['manage_stock', 'view_orders'],
    });
    expect(permsA).toEqual(permsB);
    expect(permsA).toEqual(['view_orders', 'manage_stock']);
  });

  it('undefined employeeLink.accessPreset (null preset id) + no override → employee role defaults (no preset in use)', () => {
    // Distinct from the empty-LINKED-preset case above: accessPresetId is
    // null here, so no preset is in use and the role defaults apply (the
    // four restored keys, 2026-10-28 client-compat fix). Was [] before.
    const perms = computeEffectivePermissions({
      role: 'employee',
      employeeLink: { accessPreset: null },
    });
    expect(perms).toEqual([
      'view_media',
      'view_customer_reviews',
      'approve_customer_reviews',
      'view_cod_mismatch',
    ]);
  });

  it('all registered PERMISSIONS keys are covered by the all-keys list', () => {
    Object.values(PERMISSIONS)
      .flat()
      .forEach((key) => expect(allKeys).toContain(key));
  });

  // Regression (2026-10-31, fixedplus HR-presets 500s): the three stored
  // permission lists come from Prisma Json columns. A legacy/hand-edited
  // non-array value used to throw a TypeError inside this computation —
  // which runs on every authenticated request — and 500 the request.
  // Malformed values must degrade to "no keys from this source".
  describe('malformed stored JSON (non-array permission lists)', () => {
    it('object-shaped preset permissions → treated as an empty preset, no throw', () => {
      const perms = computeEffectivePermissions({
        role: 'employee',
        employeeLink: {
          accessPresetId: 'preset-1',
          accessPreset: { permissions: { view_media: true } as unknown as string[] },
        },
      });
      expect(perms).toEqual([]);
    });

    it('string-shaped override_permissions → ignored, role defaults apply', () => {
      const perms = computeEffectivePermissions({
        role: 'employee',
        overridePermissions: 'view_media' as unknown as string[],
      });
      expect(perms).toEqual([
        'view_media',
        'view_customer_reviews',
        'approve_customer_reviews',
        'view_cod_mismatch',
      ]);
    });

    it('object-shaped denied_permissions → ignored, preset grants stand', () => {
      const perms = computeEffectivePermissions({
        role: 'employee',
        employeeLink: {
          accessPresetId: 'preset-1',
          accessPreset: { permissions: ['view_media'] },
        },
        deniedPermissions: { view_media: true } as unknown as string[],
      });
      expect(perms).toEqual(['view_media']);
    });

    it('non-string entries inside a stored array are dropped, valid keys survive', () => {
      const perms = computeEffectivePermissions({
        role: 'employee',
        employeeLink: {
          accessPresetId: 'preset-1',
          accessPreset: {
            permissions: ['view_media', 42, null, 'not_a_key'] as unknown as string[],
          },
        },
      });
      expect(perms).toEqual(['view_media']);
    });

    it('sanitizePermissions itself never throws on non-array input', () => {
      expect(sanitizePermissions(undefined)).toEqual([]);
      expect(sanitizePermissions(null as unknown as string[])).toEqual([]);
      expect(sanitizePermissions({ a: 1 } as unknown as string[])).toEqual([]);
      expect(sanitizePermissions('view_media' as unknown as string[])).toEqual([]);
    });
  });
});
