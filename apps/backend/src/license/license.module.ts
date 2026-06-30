import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseActivationService } from './license-activation.service';
import { LicenseGuard } from './license.guard';

@Global()
@Module({
  controllers: [LicenseController],
  providers: [
    LicenseService,
    LicenseActivationService,
    LicenseGuard,
    FeatureFlagsService,
  ],
  exports: [LicenseService, LicenseActivationService, LicenseGuard, FeatureFlagsService],
})
export class LicenseModule {}
