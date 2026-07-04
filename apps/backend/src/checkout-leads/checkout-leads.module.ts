import { Module } from '@nestjs/common';
import { CheckoutLeadsController } from './checkout-leads.controller';
import { CheckoutLeadsService } from './checkout-leads.service';
import { CustomersModule } from '../customers/customers.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  controllers: [CheckoutLeadsController],
  providers: [CheckoutLeadsService],
  exports: [CheckoutLeadsService],
  imports: [CustomersModule, TrackingModule],
})
export class CheckoutLeadsModule {}
