import { Module } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

@Module({
  controllers: [LicenseController],
  providers: [LicenseService, FeatureFlagsService],
  exports: [LicenseService, FeatureFlagsService],
})
export class LicenseModule {}
