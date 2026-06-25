import { Module } from '@nestjs/common';
import { OpeningBalancesService } from './opening-balances.service';
import { OpeningBalancesController } from './opening-balances.controller';
import { AccountingEnabledGuard } from '../accounting/accounting-enabled.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OpeningBalancesController],
  providers: [OpeningBalancesService, AccountingEnabledGuard],
  exports: [OpeningBalancesService],
})
export class OpeningBalancesModule {}
