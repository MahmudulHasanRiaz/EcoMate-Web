/**
 * Access-presets authorization wiring.
 *
 * `manage_presets` is a legacy catalogue key that no guard referenced until the
 * PermissionController-era work; these assertions pin both halves of the
 * defence: the permission is enforced by PermissionsGuard, AND `@Roles` stays
 * on every handler so a preset that grants `manage_presets` cannot escalate
 * itself into edit rights over the presets that granted it.
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

  it.each(HANDLERS)(
    '%s keeps @Roles("superadmin", "admin") so presets cannot grant themselves edit rights',
    (handler) => {
      expect(metaFor<string[]>(ROLES_KEY, handler)).toEqual([
        'superadmin',
        'admin',
      ]);
    },
  );

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