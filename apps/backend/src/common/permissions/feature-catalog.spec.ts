import { DEPENDENCY_MAP, FEATURES } from '@ecomate/shared-types';

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

