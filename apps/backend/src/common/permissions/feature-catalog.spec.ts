import { FEATURES } from '@ecomate/shared-types';

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