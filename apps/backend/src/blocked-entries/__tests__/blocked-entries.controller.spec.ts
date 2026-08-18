import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  BlockedEntriesController,
  BlockedEntriesPublicController,
} from '../blocked-entries.controller';

describe('BlockedEntriesController', () => {
  it('has RequiresFeature(admin_blocking) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      BlockedEntriesController,
    );
    expect(featureKey).toBe('admin_blocking');
  });

  const STAFF_ROLES = ['superadmin', 'admin', 'manager', 'cashier'];

  it.each(['findAll', 'create', 'unblock', 'toggleWhitelist'])(
    '%s is allowed for all roles except customer',
    (method) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        BlockedEntriesController.prototype[method],
      );
      expect(roles).toEqual(STAFF_ROLES);
      expect(roles).not.toContain('customer');
    },
  );
});

describe('BlockedEntriesPublicController', () => {
  const svc = { findBlockedPhone: jest.fn() };
  const ctrl = new BlockedEntriesPublicController(svc as any);

  it('reports blocked=true when the phone is on the active block list', async () => {
    svc.findBlockedPhone.mockResolvedValue({ id: 'block-1' });
    await expect(ctrl.checkPhone('01712345678')).resolves.toEqual({
      blocked: true,
    });
    expect(svc.findBlockedPhone).toHaveBeenCalledWith('01712345678');
  });

  it('reports blocked=false when the phone is not blocked', async () => {
    svc.findBlockedPhone.mockResolvedValue(null);
    await expect(ctrl.checkPhone('01712345678')).resolves.toEqual({
      blocked: false,
    });
  });
});
