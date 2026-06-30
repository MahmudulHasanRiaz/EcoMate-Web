import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseActivationService } from './license-activation.service';
import { SKIP_LICENSE_CHECK } from '../common/decorators/skip-license-check.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private licenseActivation: LicenseActivationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipLicense = this.reflector.getAllAndOverride<boolean>(SKIP_LICENSE_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipLicense) return true;

    const activation = await this.licenseActivation.find();
    if (!activation || activation.status !== 'active') {
      throw new ForbiddenException('License not activated. Please activate your license.');
    }

    return true;
  }
}
