import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, FeatureFlagsService],
  exports: [LicenseService, FeatureFlagsService],
})
export class LicenseModule {}
