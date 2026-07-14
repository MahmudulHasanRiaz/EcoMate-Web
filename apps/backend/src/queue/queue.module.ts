import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailQueueModule } from './email-queue/email-queue.module';
import { ImportQueueModule } from './import-queue/import-queue.module';
import { MediaQueueModule } from '../media/media-queue/media-queue.module';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        let host = process.env['REDIS_HOST'] || 'localhost';
        let port = Number(process.env['REDIS_PORT']) || 6379;
        let password = process.env['REDIS_PASSWORD'] || undefined;
        const redisUrl = process.env['REDIS_URL'];
        if (redisUrl && !process.env['REDIS_HOST']) {
          try {
            const url = new URL(redisUrl);
            host = url.hostname || host;
            port = Number(url.port) || port;
            password = url.password || password;
          } catch {}
        }
        return {
          connection: { host, port, password },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        };
      },
    }),
    EmailQueueModule,
    ImportQueueModule,
    MediaQueueModule,
  ],
  exports: [BullModule, EmailQueueModule, ImportQueueModule, MediaQueueModule],
})
export class QueueModule {}
