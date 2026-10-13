import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';
import { CustomerCreditModule } from '../customer-credit/customer-credit.module';

@Module({
  imports: [CodMismatchModule, CustomerCreditModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
