import * as fs from 'fs';
import * as path from 'path';
import { FEATURES, DEPENDENCY_MAP } from '@ecomate/shared-types';

describe('feature catalog — HR module registration (P0-I)', () => {
  it('registers admin_hr umbrella feature', () => {
    expect(FEATURES).toHaveProperty('admin_hr');
    expect(FEATURES['admin_hr'].key).toBe('admin_hr');
    expect(FEATURES['admin_hr'].enabled).toBe(true);
  });

  it('registers admin_staff_users feature', () => {
    expect(FEATURES).toHaveProperty('admin_staff_users');
    expect(FEATURES['admin_staff_users'].enabled).toBe(true);
  });

  it('registers admin_access_presets feature', () => {
    expect(FEATURES).toHaveProperty('admin_access_presets');
    expect(FEATURES['admin_access_presets'].enabled).toBe(true);
  });
});

describe('feature catalog — central-commerce P0 keys', () => {
  const NEW_KEYS = [
    'admin_stores',
    'store_product_sync',
    'store_order_sync',
    'store_stock_sync',
    'admin_sync_center',
  ];

  it.each(NEW_KEYS)('registers %s enabled', (key) => {
    expect(FEATURES).toHaveProperty(key);
    expect(FEATURES[key].key).toBe(key);
    expect(FEATURES[key].enabled).toBe(true);
  });

  it('wires central-commerce dependencies (parent → children)', () => {
    expect(DEPENDENCY_MAP['admin_stores']).toEqual(
      expect.arrayContaining(['admin_products', 'admin_orders']),
    );
    for (const child of [
      'store_product_sync',
      'store_order_sync',
      'store_stock_sync',
      'admin_sync_center',
    ]) {
      expect(DEPENDENCY_MAP[child]).toEqual(['admin_stores']);
    }
  });
});

describe('feature catalog — courier settlement (settlement module)', () => {
  it('registers admin_courier_settlement enabled', () => {
    expect(FEATURES).toHaveProperty('admin_courier_settlement');
    expect(FEATURES['admin_courier_settlement'].key).toBe(
      'admin_courier_settlement',
    );
    expect(FEATURES['admin_courier_settlement'].enabled).toBe(true);
  });

  it('requires admin_accounting + admin_orders (money + order cost sources)', () => {
    expect(FEATURES['admin_courier_settlement'].dependencies).toEqual([
      'admin_accounting',
      'admin_orders',
    ]);
    expect(DEPENDENCY_MAP['admin_courier_settlement']).toEqual([
      'admin_accounting',
      'admin_orders',
    ]);
  });
});

describe('feature catalog — @RequiresFeature ↔ catalog consistency (P0)', () => {
  /**
   * Six pre-existing decorator keys absent from the catalog → permanently
   * 403 (plan §3.5 / R-11). Allow-listed here, reported, never silently
   * changed. Any NEW missing key fails the build.
   */
  const PRE_EXISTING_MISMATCH_ALLOWLIST = [
    'admin_campaigns',
    'admin_cms',
    'admin_courier',
    'admin_shipments',
    'admin_import',
    'admin_checkout_leads',
  ];

  function collectUsedKeys(srcDir: string): string[] {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts') &&
          !entry.name.endsWith('.test.ts')
        ) {
          const content = fs.readFileSync(full, 'utf8');
          const re = /RequiresFeature\(\s*['"]([^'"]+)['"]/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(content)) !== null) found.add(m[1]);
        }
      }
    };
    walk(srcDir);
    return [...found].sort();
  }

  it('reports exactly the six pre-existing mismatches, no more', () => {
    const srcDir = path.resolve(__dirname, '..', '..');
    const used = collectUsedKeys(srcDir);
    expect(used.length).toBeGreaterThan(0);
    const missing = used.filter((k) => !(k in FEATURES));
    expect(missing.sort()).toEqual(
      [...PRE_EXISTING_MISMATCH_ALLOWLIST].sort(),
    );
  });

  it('every newly added central-commerce key is actually referenced-or-reserved', () => {
    // Reserved by design: P1+ controllers will reference them. The catalog
    // must contain them BEFORE first use (R-11: unknown key ⇒ permanent 403).
    for (const k of [
      'admin_stores',
      'store_product_sync',
      'store_order_sync',
      'store_stock_sync',
      'admin_sync_center',
    ]) {
      expect(FEATURES[k]).toBeDefined();
    }
  });
});
