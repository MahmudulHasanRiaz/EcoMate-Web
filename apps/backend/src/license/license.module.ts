import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseEngine } from '@ecomate/license-engine';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/utils/encryption';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseActivationService } from './license-activation.service';
import { LicenseGuard } from './license.guard';

function createLicenseEngine(config: ConfigService): LicenseEngine {
  const url =
    config.get<string>('KEYMATE_API_URL') ||
    'https://keygen-keymate.commercians.com/v1/saas';
  return new LicenseEngine({ keymateUrl: url });
}

@Global()
@Module({
  controllers: [LicenseController],
  providers: [
    LicenseService,
    LicenseActivationService,
    LicenseGuard,
    EncryptionService,
    FeatureFlagsService,
    {
      provide: LicenseEngine,
      useFactory: createLicenseEngine,
      inject: [ConfigService],
    },
  ],
  exports: [
    LicenseService,
    LicenseActivationService,
    LicenseGuard,
    FeatureFlagsService,
  ],
})
export class LicenseModule {}
