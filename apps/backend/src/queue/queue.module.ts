import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailQueueModule } from './email-queue/email-queue.module';
import { ImportQueueModule } from './import-queue/import-queue.module';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env['REDIS_HOST'] || 'localhost',
          port: Number(process.env['REDIS_PORT']) || 6379,
          password: process.env['REDIS_PASSWORD'] || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),
    EmailQueueModule,
    ImportQueueModule,
  ],
  exports: [BullModule, EmailQueueModule, ImportQueueModule],
})
export class QueueModule {}
