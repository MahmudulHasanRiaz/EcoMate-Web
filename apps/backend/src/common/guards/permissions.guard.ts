import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_ANY_KEY,
} from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    /**
     * `@Public()` routes are served to anonymous storefront traffic, so they can
     * never carry a `request.user` and therefore have no permissions to check.
     * Without this short-circuit, adding a class-level `@Permissions(...)` to a
     * controller that also exposes a public handler (e.g. `GET /products`)
     * would 403 anonymous requests — the handler metadata would no longer be
     * able to opt out on its own. Mirrors `LicenseGuard`.
     */
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAnyPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!requiredAnyPermissions || requiredAnyPermissions.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userPermissions: string[] = request.user?.permissions || [];

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasAll = requiredPermissions.every((perm) =>
        userPermissions.includes(perm),
      );
      if (!hasAll) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    if (requiredAnyPermissions && requiredAnyPermissions.length > 0) {
      const hasAny = requiredAnyPermissions.some((perm) =>
        userPermissions.includes(perm),
      );
      if (!hasAny) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return true;
  }
}
