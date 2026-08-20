import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { MarketingPlatformsService } from './marketing-platforms.service';
import { MarketingConnectionsService } from './marketing-connections.service';
import { MarketingSyncService } from './marketing-sync.service';
import { MarketingConsumptionService } from './marketing-consumption.service';
import { MarketingAllocationService } from './marketing-allocation.service';
import { MarketingFundingService } from './marketing-funding.service';
import { MarketingAttributionService } from './marketing-attribution.service';
import { MarketingAnalysisService } from './marketing-analysis.service';
import { MarketingSnapshotService } from './marketing-snapshot.service';
import { MetaGraphService } from './meta-graph.service';
import { MarketingSyncProcessor, enqueueMarketingSync } from './marketing-sync.processor';
import { MarketingController } from './marketing.controller';
import { MarketingFundingController } from './marketing-funding.controller';
import { MarketingAnalysisController } from './marketing-analysis.controller';
import { MarketingSnapshotController } from './marketing-snapshot.controller';
import { MarketingCaptureController } from './marketing-capture.controller';
import { MarketingWebhooksController } from './marketing-webhooks.controller';
import { MARKETING_QUEUE, DEFAULT_SYNC_INTERVAL_HOURS, SYNC_INTERVAL_SETTING } from './marketing.constants';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Module({
  imports: [
    PrismaModule,
    AccountingModule,
    BullModule.registerQueue({ name: MARKETING_QUEUE }),
  ],
  controllers: [
    MarketingController,
    MarketingFundingController,
    MarketingAnalysisController,
    MarketingSnapshotController,
    MarketingCaptureController,
    MarketingWebhooksController,
  ],
  providers: [
    MarketingPlatformsService,
    MarketingConnectionsService,
    MarketingSyncService,
    MarketingConsumptionService,
    MarketingAllocationService,
    MarketingFundingService,
    MarketingAttributionService,
    MarketingAnalysisService,
    MarketingSnapshotService,
    MetaGraphService,
    EncryptionService,
    MarketingSyncProcessor,
  ],
  exports: [
    MarketingAttributionService,
    MarketingAllocationService,
    MarketingSyncService,
    MarketingPlatformsService,
  ],
})
export class MarketingModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(MarketingModule.name);

  constructor(
    @InjectQueue(MARKETING_QUEUE) private marketingQueue: Queue,
    private prisma: PrismaService,
    private platforms: MarketingPlatformsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.platforms.ensureDefaults();

      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: SYNC_INTERVAL_SETTING },
      });
      const hours = setting?.value ? parseInt(setting.value, 10) : DEFAULT_SYNC_INTERVAL_HOURS;
      const intervalMs = Math.max(1, isNaN(hours) ? DEFAULT_SYNC_INTERVAL_HOURS : hours) * 3600 * 1000;

      await enqueueMarketingSync(
        this.marketingQueue as any,
        { type: 'sync-all' },
        'marketing-sync-repeat',
      );
      await this.marketingQueue.add(
        'sync-all',
        { type: 'sync-all' } as any,
        {
          jobId: 'marketing-sync-repeat',
          repeat: { every: intervalMs },
          removeOnComplete: 1,
          removeOnFail: 200,
        },
      );
      this.logger.log(`Marketing sync repeat job scheduled every ${intervalMs / 3600 / 1000}h`);
    } catch (err) {
      this.logger.warn(
        `Marketing sync bootstrap skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}