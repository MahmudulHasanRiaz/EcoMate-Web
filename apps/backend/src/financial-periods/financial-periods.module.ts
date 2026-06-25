import { Module } from '@nestjs/common';
import { FinancialPeriodsService } from './financial-periods.service';
import { FinancialPeriodsController } from './financial-periods.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinancialPeriodsController],
  providers: [FinancialPeriodsService],
  exports: [FinancialPeriodsService],
})
export class FinancialPeriodsModule {}
