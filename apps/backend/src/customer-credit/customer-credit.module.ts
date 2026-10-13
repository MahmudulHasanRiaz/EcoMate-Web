import { Module } from '@nestjs/common';
import { CustomerCreditService } from './customer-credit.service';
import { CustomerCreditController } from './customer-credit.controller';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';

@Module({
  imports: [CodMismatchModule],
  controllers: [CustomerCreditController],
  providers: [CustomerCreditService],
  exports: [CustomerCreditService],
})
export class CustomerCreditModule {}
