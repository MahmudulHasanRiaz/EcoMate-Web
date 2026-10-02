import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseEngine } from '@ecomate/license-engine';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/utils/encryption';
import { EncryptionKeyProvisioner } from '../common/utils/encryption-key-provisioner';
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
    // Runs onModuleInit and ensures LICENSE_ENCRYPTION_KEY exists (env →
    // persisted volume → freshly generated) before anything encrypts. Registered
    // here because LicenseModule is @Global, so the other two consumers —
    // attendance devices and marketing OAuth — get the same provisioned key.
    EncryptionKeyProvisioner,
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
    EncryptionService,
    EncryptionKeyProvisioner,
  ],
})
export class LicenseModule {}
