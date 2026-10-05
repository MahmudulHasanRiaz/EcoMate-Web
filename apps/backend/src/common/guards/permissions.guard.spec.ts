import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  ForbiddenException,
  Controller,
  Get,
} from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import {
  Permissions,
  PermissionsAny,
  PERMISSIONS_KEY,
  PERMISSIONS_ANY_KEY,
} from '../decorators/permissions.decorator';
import {
  Public,
  IS_PUBLIC_KEY,
} from '../decorators/public.decorator';

@Controller('demo')
class DemoPermissionsController {
  @Get('all')
  @Permissions('view_orders', 'view_products')
  allMode() {
    return 'ok';
  }

  @Get('any')
  @PermissionsAny('view_orders', 'view_products')
  anyMode() {
    return 'ok';
  }

  @Get('both')
  @Permissions('view_orders', 'view_products')
  @PermissionsAny('manage_stock', 'refund_orders')
  bothModes() {
    return 'ok';
  }

  @Get('none')
  none() {
    return 'ok';
  }
}

/**
 * Mirrors the real `GET /products` shape: a class-level `@Permissions(...)`
 * opt-in (as the CRUD controllers use) alongside a `@Public()` handler that
 * serves anonymous storefront traffic.
 */
@Controller('demo-storefront')
@Permissions('view_products')
class DemoPublicController {
  @Public()
  @Get()
  publicList() {
    return 'ok';
  }

  @Get('admin')
  protectedList() {
    return 'ok';
  }
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsGuard, Reflector],
    }).compile();
    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  const createContext = (
    permissions: string[] | undefined,
    handler: (...args: any[]) => any,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => DemoPermissionsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions } }),
      }),
    }) as any;

  /** Anonymous request — `request.user` is absent, as it is for storefront traffic. */
  const createAnonymousContext = (
    handler: (...args: any[]) => any,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => DemoPublicController,
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    }) as any;

  const createClassContext = (
    permissions: string[] | undefined,
    handler: (...args: any[]) => any,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => DemoPublicController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions } }),
      }),
    }) as any;

  it('passes when no permission metadata present', () => {
    const result = guard.canActivate(
      createContext(['view_orders'], DemoPermissionsController.prototype.none),
    );
    expect(result).toBe(true);
  });

  it('passes when no permission metadata and user has no permissions at all', () => {
    const result = guard.canActivate(
      createContext(undefined, DemoPermissionsController.prototype.none),
    );
    expect(result).toBe(true);
  });

  describe('@Public() short-circuit', () => {
    it('passes a @Public() handler even when the user lacks the permission', () => {
      const result = guard.canActivate(
        createClassContext(
          [],
          DemoPublicController.prototype.publicList,
        ),
      );
      expect(result).toBe(true);
    });

    it('passes a @Public() handler for a fully anonymous request', () => {
      const result = guard.canActivate(
        createAnonymousContext(DemoPublicController.prototype.publicList),
      );
      expect(result).toBe(true);
    });

    it('still 403s a non-public handler on the same controller', () => {
      expect(() =>
        guard.canActivate(
          createClassContext(
            ['view_orders'],
            DemoPublicController.prototype.protectedList,
          ),
        ),
      ).toThrow(ForbiddenException);
    });

    it('still allows a non-public handler when the permission is held', () => {
      const result = guard.canActivate(
        createClassContext(
          ['view_products'],
          DemoPublicController.prototype.protectedList,
        ),
      );
      expect(result).toBe(true);
    });

    it('does not skip the permission check for a non-public route', () => {
      expect(
        reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          DemoPublicController.prototype.protectedList,
          DemoPublicController,
        ]),
      ).toBeUndefined();
    });
  });

  describe('ALL-mode @Permissions', () => {
    it('passes when all required permissions present', () => {
      const result = guard.canActivate(
        createContext(
          ['view_orders', 'view_products'],
          DemoPermissionsController.prototype.allMode,
        ),
      );
      expect(result).toBe(true);
    });

    it('fails when one required permission missing', () => {
      expect(() =>
        guard.canActivate(
          createContext(
            ['view_orders'],
            DemoPermissionsController.prototype.allMode,
          ),
        ),
      ).toThrow(ForbiddenException);
    });

    it('fails when user permissions undefined', () => {
      expect(() =>
        guard.canActivate(
          createContext(undefined, DemoPermissionsController.prototype.allMode),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('ANY-mode @PermissionsAny', () => {
    it('passes when at least one permission present', () => {
      const result = guard.canActivate(
        createContext(
          ['view_orders'],
          DemoPermissionsController.prototype.anyMode,
        ),
      );
      expect(result).toBe(true);
    });

    it('fails when none of the listed permissions present', () => {
      expect(() =>
        guard.canActivate(
          createContext(
            ['manage_stock'],
            DemoPermissionsController.prototype.anyMode,
          ),
        ),
      ).toThrow(ForbiddenException);
    });

    it('fails when user permissions undefined', () => {
      expect(() =>
        guard.canActivate(
          createContext(undefined, DemoPermissionsController.prototype.anyMode),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('both metadata kinds present', () => {
    it('fails when ALL-mode missing even if ANY-mode satisfied', () => {
      expect(() =>
        guard.canActivate(
          createContext(
            ['refund_orders'],
            DemoPermissionsController.prototype.bothModes,
          ),
        ),
      ).toThrow(ForbiddenException);
    });

    it('passes when both ALL and ANY satisfied', () => {
      const result = guard.canActivate(
        createContext(
          ['view_orders', 'view_products', 'manage_stock'],
          DemoPermissionsController.prototype.bothModes,
        ),
      );
      expect(result).toBe(true);
    });
  });

  describe('decorator metadata keys', () => {
    it('@Permissions stores under PERMISSIONS_KEY (unchanged semantics)', () => {
      const meta = Reflect.getMetadata(
        PERMISSIONS_KEY,
        DemoPermissionsController.prototype.allMode,
      );
      expect(meta).toEqual(['view_orders', 'view_products']);
    });

    it('@PermissionsAny stores under PERMISSIONS_ANY_KEY (distinct key)', () => {
      const meta = Reflect.getMetadata(
        PERMISSIONS_ANY_KEY,
        DemoPermissionsController.prototype.anyMode,
      );
      expect(meta).toEqual(['view_orders', 'view_products']);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          DemoPermissionsController.prototype.anyMode,
        ),
      ).toBeUndefined();
    });

    it('both decorators coexist on the same handler', () => {
      const all = Reflect.getMetadata(
        PERMISSIONS_KEY,
        DemoPermissionsController.prototype.bothModes,
      );
      const any = Reflect.getMetadata(
        PERMISSIONS_ANY_KEY,
        DemoPermissionsController.prototype.bothModes,
      );
      expect(all).toEqual(['view_orders', 'view_products']);
      expect(any).toEqual(['manage_stock', 'refund_orders']);
    });
  });
});