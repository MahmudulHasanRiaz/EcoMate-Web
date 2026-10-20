import { Module } from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { CommissionsController } from './commissions.controller';
import { CommissionEngineService } from './commission-engine.service';
import { CommissionRulesService } from './commission-rules.service';
import { CommissionReportsService } from './commission-reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [PrismaModule, ExpensesModule],
  controllers: [CommissionsController],
  providers: [
    CommissionsService,
    CommissionEngineService,
    CommissionRulesService,
    CommissionReportsService,
  ],
  // CommissionEngineService is exported because OrdersModule writes status
  // transitions and must feed the engine from every one of them.
  exports: [CommissionsService, CommissionEngineService],
})
export class CommissionsModule {}