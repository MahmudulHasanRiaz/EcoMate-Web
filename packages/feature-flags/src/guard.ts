import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { REQUIRES_FEATURE_KEY } from './decorator';
import { FeatureFlagsService } from './feature-flags.service';

const FEATURE_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'License key not found. Please verify your license key.',
  domain_mismatch: 'Domain mismatch. This license is not valid for this domain.',
  expired: 'License has expired. Please renew your license.',
  invalid_api_key: 'Invalid API key. The server rejected the request.',
  unauthorized: 'Authorization failed. Please check your API key.',
  unreachable: 'License server unreachable. Cannot verify feature access at this time.',
  engine_unavailable: 'License engine not available. Please restart the application.',
  not_verified: 'License not yet verified. Please try again in a moment.',
  validation_failed: 'License validation failed. Please contact support.',
  invalid_token: 'Invalid license token. Please reactivate your license.',
};

@Injectable()
export class FeatureGuard implements CanActivate {
  private featureFlags!: FeatureFlagsService;

  constructor(
    private reflector: Reflector,
    private moduleRef: ModuleRef,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.featureFlags) {
      this.featureFlags = this.moduleRef.get(FeatureFlagsService, { strict: false });
    }

    const featureKey = this.reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!featureKey) return true;

    const lic = this.featureFlags.getLicense();

    if (lic === null) {
      throw new ForbiddenException(
        FEATURE_ERROR_MESSAGES['not_verified'] || 'License not yet verified. Please try again in a moment.',
      );
    }

    if (!this.featureFlags.canUse(featureKey)) {
      const code = lic.code;
      const message = code
        ? (FEATURE_ERROR_MESSAGES[code] || `License error: ${code}`)
        : `Feature "${featureKey}" is not included in your plan`;
      throw new ForbiddenException(message);
    }

    return true;
  }
}
