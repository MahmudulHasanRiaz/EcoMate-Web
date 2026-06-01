import { Module } from '@nestjs/common';
import { CheckoutLeadsController } from './checkout-leads.controller';
import { CheckoutLeadsService } from './checkout-leads.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  controllers: [CheckoutLeadsController],
  providers: [CheckoutLeadsService],
  exports: [CheckoutLeadsService],
  imports: [CustomersModule],
})
export class CheckoutLeadsModule {}
