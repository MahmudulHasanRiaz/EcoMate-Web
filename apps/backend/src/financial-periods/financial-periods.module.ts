import { Module } from '@nestjs/common';
import { FinancialPeriodsService } from './financial-periods.service';
import { FinancialPeriodsController } from './financial-periods.controller';
import { AccountingEnabledGuard } from '../accounting/accounting-enabled.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinancialPeriodsController],
  providers: [FinancialPeriodsService, AccountingEnabledGuard],
  exports: [FinancialPeriodsService],
})
export class FinancialPeriodsModule {}
