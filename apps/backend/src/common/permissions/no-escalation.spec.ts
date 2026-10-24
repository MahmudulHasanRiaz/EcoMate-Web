import { ForbiddenException } from '@nestjs/common';
import {
  assertCanAssignRole,
  assertNoEscalation,
} from './no-escalation';
import { getAllPermissions } from './registry';

describe('no-escalation', () => {
  const all = getAllPermissions();

  it('allows granting a subset of what the actor holds', () => {
    expect(() =>
      assertNoEscalation(['view_orders', 'create_orders'], ['view_orders'], 'preset'),
    ).not.toThrow();
  });

  it('forbids granting anything beyond the actor set', () => {
    expect(() =>
      assertNoEscalation(['view_orders'], ['view_orders', 'manage_presets'], 'preset'),
    ).toThrow(ForbiddenException);
  });

  it('allows empty grants and skips when the actor is unknown (direct service call)', () => {
    expect(() => assertNoEscalation(['view_orders'], [], 'preset')).not.toThrow();
    expect(() => assertNoEscalation(undefined, ['view_orders'], 'preset')).not.toThrow();
  });

  it('allows a full-access actor to assign admin/superadmin roles', () => {
    expect(() => assertCanAssignRole(all, 'admin', all)).not.toThrow();
    expect(() => assertCanAssignRole(all, 'superadmin', all)).not.toThrow();
  });

  it('forbids a restricted actor from assigning admin/superadmin roles', () => {
    expect(() => assertCanAssignRole(['view_orders'], 'admin', all)).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanAssignRole(['view_orders'], 'superadmin', all)).toThrow(
      ForbiddenException,
    );
  });

  it('allows a restricted actor to assign employee/cashier/packing_assistant roles', () => {
    for (const role of ['employee', 'cashier', 'packing_assistant']) {
      expect(() => assertCanAssignRole(['view_orders'], role, all)).not.toThrow();
    }
  });
});
