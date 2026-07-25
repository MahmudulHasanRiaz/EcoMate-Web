import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'backup' }),
  ],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}