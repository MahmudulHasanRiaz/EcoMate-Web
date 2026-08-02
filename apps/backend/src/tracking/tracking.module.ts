import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TrackingContextService } from './tracking-context.service';
import { TrackingController } from './tracking.controller';
import { PageViewBufferService } from './page-view-buffer.service';
import { TrackingSettingsService } from './tracking-settings.service';
import { TrackingCaptureService } from './tracking-capture.service';
import { TrackingDispatcherService } from './tracking-dispatcher.service';
import { TrackingDispatcherProcessor } from './tracking-dispatcher.processor';
import { OutboxRelayService } from './outbox-relay.service';
import { ReconcilerService } from './reconciler.service';
import { DlqService } from './dlq.service';
import { ReplayService } from './replay.service';
import { ReplayController } from './replay.controller';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'tracking' }),
    // DLQ mirror of DEAD outbox rows (design §7.3) — no worker: jobs are a
    // bounded ops-visibility mirror; the DB DEAD rows are the durable record.
    BullModule.registerQueue({
      name: 'tracking-dlq',
      defaultJobOptions: { removeOnComplete: 0, removeOnFail: 100 },
    }),
  ],
  controllers: [TrackingController, ReplayController, MonitoringController],
  providers: [
    TrackingContextService,
    PageViewBufferService,
    TrackingSettingsService,
    TrackingCaptureService,
    TrackingDispatcherService,
    TrackingDispatcherProcessor,
    OutboxRelayService,
    ReconcilerService,
    DlqService,
    ReplayService,
    MonitoringService,
  ],
  exports: [
    TrackingContextService,
    PageViewBufferService,
    TrackingSettingsService,
    TrackingCaptureService,
    TrackingDispatcherService,
    DlqService,
    ReplayService,
    MonitoringService,
  ],
})
export class TrackingModule {}
