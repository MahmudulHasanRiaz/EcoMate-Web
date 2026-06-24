import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_FEATURE_KEY } from './decorator';
import { FeatureFlagsService } from './index';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private featureFlags: FeatureFlagsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const featureKey = this.reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!featureKey) return true;
    return this.featureFlags.canUse(featureKey);
  }
}
