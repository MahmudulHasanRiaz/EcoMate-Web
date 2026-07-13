import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { FEATURE_KEY } from './decorator';
import { FeatureFlagsService } from './feature-flags.service';

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

    const featureMeta = this.reflector.getAllAndOverride<{ feature: string; dependencies: string[] }>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!featureMeta) return true;

    if (!this.featureFlags.canUse(featureMeta.feature)) {
      throw new ForbiddenException(`Feature "${featureMeta.feature}" is not included in your plan`);
    }

    return true;
  }
}
