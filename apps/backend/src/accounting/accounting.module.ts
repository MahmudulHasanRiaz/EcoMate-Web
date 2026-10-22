import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { AccountingEnabledGuard } from './accounting-enabled.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialPeriodsModule } from '../financial-periods/financial-periods.module';
import { FinancialPeriodsService } from '../financial-periods/financial-periods.service';

@Module({
  imports: [PrismaModule, FinancialPeriodsModule],
  controllers: [AccountingController],
  providers: [AccountingService, AccountingEnabledGuard],
  exports: [AccountingService, AccountingEnabledGuard],
})
export class AccountingModule implements OnModuleInit {
  private readonly logger = new Logger(AccountingModule.name);

  constructor(private financialPeriods: FinancialPeriodsService) {}

  async onModuleInit() {
    try {
      const { created, existing } =
        await this.financialPeriods.ensureCurrentYearPeriods();

      if (created > 0) {
        this.logger.log(
          `Ensured accounting periods for the current year: ${created} created, ${existing} already present`,
        );
      } else {
        this.logger.debug(
          `Accounting periods already present for the current year (${existing})`,
        );
      }
    } catch (err: any) {
      // Bootstrap must never crash the app: accounting stays gated by
      // AccountingEnabledGuard on SystemSetting.accounting_enabled.
      this.logger.error(
        `Failed to ensure current-year accounting periods: ${err?.message ?? err}`,
      );
    }
  }
}
