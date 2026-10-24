/**
 * Access-presets authorization wiring (preset supremacy, owner 2026-10-24).
 *
 * `manage_presets` is enforced by PermissionsGuard, and NO handler carries a
 * role gate — a preset holder with manage_presets must be able to manage
 * presets. Self-escalation is prevented capability-side instead: the
 * controller refuses to grant permissions the actor does not already hold
 * (assertNoEscalation), so a preset can never be edited into something
 * broader than its editor.
 */
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AccessPresetsController } from '../access-presets.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const HANDLERS = ['create', 'findAll', 'findOne', 'update', 'remove'] as const;

describe('AccessPresetsController authorization', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsGuard, Reflector],
    }).compile();
    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  const metaFor = <T>(key: string, handlerName: string): T | undefined =>
    reflector.getAllAndOverride<T>(key, [
      (AccessPresetsController.prototype as any)[handlerName],
      AccessPresetsController,
    ]);

  const contextFor = (
    permissions: string[] | undefined,
    handlerName: string,
  ): any => ({
    getHandler: () => (AccessPresetsController.prototype as any)[handlerName],
    getClass: () => AccessPresetsController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { permissions } }),
    }),
  });

  it('gates the controller on admin_access_presets', () => {
    expect(
      reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
        AccessPresetsController,
      ]),
    ).toBe('admin_access_presets');
  });

  it.each(HANDLERS)('%s declares @Permissions("manage_presets")', (handler) => {
    expect(metaFor<string[]>(PERMISSIONS_KEY, handler)).toContain(
      'manage_presets',
    );
  });

  it.each(HANDLERS)('%s declares NO @Roles() (preset supremacy)', (handler) => {
    expect(metaFor<string[]>(ROLES_KEY, handler)).toBeUndefined();
  });

  it('create refuses to grant permissions the actor does not hold', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'p1' }),
    } as any;
    const controller = new AccessPresetsController(service);
    await expect(
      controller.create(
        { name: 'Escalated', permissions: ['view_orders', 'manage_presets'] } as any,
        { permissions: ['manage_presets'] },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('create allows granting permissions the actor already holds', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'p1' }),
    } as any;
    const controller = new AccessPresetsController(service);
    await controller.create(
      { name: 'Narrow', permissions: ['view_orders'] } as any,
      { permissions: ['view_orders', 'manage_presets'] },
    );
    expect(service.create).toHaveBeenCalled();
  });

  it.each(HANDLERS)('denies %s without manage_presets', (handler) => {
    expect(() => guard.canActivate(contextFor([], handler))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextFor(undefined, handler))).toThrow(
      ForbiddenException,
    );
  });

  it.each(HANDLERS)('allows %s with manage_presets', (handler) => {
    expect(
      guard.canActivate(contextFor(['manage_presets'], handler)),
    ).toBe(true);
  });
});