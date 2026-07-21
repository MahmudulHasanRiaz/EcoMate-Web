import { Module, Global } from '@nestjs/common';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';
import { BlockedEntriesModule } from '../blocked-entries/blocked-entries.module';
import { BlockSettingsModule } from '../block-settings/block-settings.module';
import { SecurityDashboardModule } from '../security-dashboard/security-dashboard.module';

@Global()
@Module({
  imports: [BlockedEntriesModule, BlockSettingsModule, SecurityDashboardModule],
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
