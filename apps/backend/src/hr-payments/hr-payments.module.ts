import { Module } from '@nestjs/common';
import { HrPaymentsService } from './hr-payments.service';
import { HrPaymentsController } from './hr-payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [HrPaymentsController],
  providers: [HrPaymentsService],
  exports: [HrPaymentsService],
})
export class HrPaymentsModule {}
