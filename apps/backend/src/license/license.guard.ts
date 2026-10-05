import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseActivationService } from './license-activation.service';
import { SKIP_LICENSE_CHECK } from '../common/decorators/skip-license-check.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

const LICENSE_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'License key not found in system. Please reactivate your license.',
  domain_mismatch:
    'Domain mismatch. This license is not valid for this domain.',
  expired: 'License has expired. Please renew your license to continue.',
  invalid_api_key: 'Invalid API key. Please check your license configuration.',
  unauthorized:
    'Authorization failed. Please check your license configuration.',
  unreachable:
    'License server unreachable. The application may have limited functionality until connectivity is restored.',
  offline_cache: 'License server unreachable. Using cached license.',
  engine_unavailable:
    'License engine not available. Please restart the application.',
  decryption_failed:
    'Cannot decrypt stored credentials. The encryption key may have changed.',
  validation_failed: 'License validation failed. Please contact support.',
  not_verified: 'License not yet verified. Please try again shortly.',
};

/**
 * Session endpoints that must keep working while the license is invalid.
 *
 * `/auth/me` hydrates the current user's profile and permissions for the
 * admin layout, and `/auth/logout` lets a user end their session cleanly.
 * Without these exemptions an invalid license locked users inside a broken
 * shell: every page 403'd, the menus collapsed, and signing out 403'd too.
 * All other authenticated routes remain license-gated.
 */
function isLicenseExemptPath(pathname: string): boolean {
  const p = pathname.split('?', 1)[0];
  return (
    p === '/api/auth/me' ||
    p === '/auth/me' ||
    p === '/api/auth/logout' ||
    p === '/auth/logout'
  );
}

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private licenseActivation: LicenseActivationService,
    private featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.SKIP_LICENSE_CHECK === 'true') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipLicense = this.reflector.getAllAndOverride<boolean>(
      SKIP_LICENSE_CHECK,
      [context.getHandler(), context.getClass()],
    );
    if (skipLicense) return true;

    const request = context.switchToHttp().getRequest();
    if (isLicenseExemptPath(request?.url || '')) return true;

    try {
      const activation = await this.licenseActivation.find();
      if (!activation) {
        throw new ForbiddenException(
          process.env.NODE_ENV === 'production'
            ? 'This EcoMate installation requires a valid license. Please contact your service provider.'
            : 'License not activated. Please activate your license to continue.',
        );
      }

      if (activation.status !== 'active') {
        const code = activation.errorMessage || 'inactive';
        const message =
          LICENSE_ERROR_MESSAGES[code] ||
          `License is ${activation.status}: ${code}`;
        throw new ForbiddenException(message);
      }

      const lic = this.featureFlags.getLicense();
      if (lic && !lic.valid) {
        const code = lic.code || 'unknown';
        if (code !== 'not_verified' && code !== 'engine_unavailable') {
          const message =
            LICENSE_ERROR_MESSAGES[code] || `License error: ${code}`;
          throw new ForbiddenException(message);
        }
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new ServiceUnavailableException(
        'License check temporarily unavailable. Please try again.',
      );
    }
  }
}
