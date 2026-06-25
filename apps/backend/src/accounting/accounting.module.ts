import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { AccountingEnabledGuard } from './accounting-enabled.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AccountingController],
  providers: [AccountingService, AccountingEnabledGuard],
  exports: [AccountingService, AccountingEnabledGuard],
})
export class AccountingModule {}
