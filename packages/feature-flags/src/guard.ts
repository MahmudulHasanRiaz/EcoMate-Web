import { Injectable, CanActivate, ExecutionContext, Inject } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { REQUIRES_FEATURE_KEY } from './decorator';
import { FeatureFlagsService } from './index';

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
    return this.featureFlags.canUse(featureKey);
  }
}
