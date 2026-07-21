import { Module, Global } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { TrustTierService } from './trust-tier.service';
import { RateLimitCounterService } from './rate-limit-counter.service';
import { RiskContextService } from './risk-context.service';
import { RiskScoreService } from './risk-score.service';
import { AdaptiveRateLimiterGuard } from './adaptive-rate-limiter.guard';
import { RateLimitController } from './rate-limit.controller';
import { BlockedEntriesModule } from '../../blocked-entries/blocked-entries.module';
import { BlockSettingsModule } from '../../block-settings/block-settings.module';
import { SecurityDashboardModule } from '../../security-dashboard/security-dashboard.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    BlockedEntriesModule,
    BlockSettingsModule,
    SecurityDashboardModule,
  ],
  controllers: [RateLimitController],
  providers: [
    RateLimitPolicyStore,
    TrustTierService,
    RateLimitCounterService,
    RiskContextService,
    RiskScoreService,
    {
      provide: APP_GUARD,
      useClass: AdaptiveRateLimiterGuard,
    },
  ],
  exports: [
    RateLimitPolicyStore,
    TrustTierService,
    RateLimitCounterService,
    RiskContextService,
    RiskScoreService,
  ],
})
export class RateLimitModule {}
