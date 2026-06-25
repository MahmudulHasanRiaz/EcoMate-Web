import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { AccountingEnabledGuard } from '../accounting/accounting-enabled.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AccountsController],
  providers: [AccountsService, AccountingEnabledGuard],
  exports: [AccountsService],
})
export class AccountsModule {}
