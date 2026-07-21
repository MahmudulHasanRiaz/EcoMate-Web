import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityDashboardController } from './security-dashboard.controller';
import { SecurityEventEmitterService } from './services/security-event-emitter.service';
import { DashboardQueryService } from './services/dashboard-query.service';
import { EventAggregatorService } from './services/event-aggregator.service';
import { RetentionCleanupService } from './services/retention-cleanup.service';
import { SecurityEventProcessor } from './processors/security-event.processor';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: 'security-events' },
      { name: 'security-aggregate' },
    ),
  ],
  controllers: [SecurityDashboardController],
  providers: [
    SecurityEventEmitterService,
    DashboardQueryService,
    EventAggregatorService,
    RetentionCleanupService,
    SecurityEventProcessor,
  ],
  exports: [SecurityEventEmitterService, DashboardQueryService],
})
export class SecurityDashboardModule {}
