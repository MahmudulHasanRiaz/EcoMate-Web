import { Module } from '@nestjs/common';
import { CheckoutLeadsController } from './checkout-leads.controller';
import { CheckoutLeadsService } from './checkout-leads.service';
import { CustomersModule } from '../customers/customers.module';
import { SalesChannelModule } from '../sales-channel/sales-channel.module';
import { TrackingModule } from '../tracking/tracking.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  controllers: [CheckoutLeadsController],
  providers: [CheckoutLeadsService],
  exports: [CheckoutLeadsService],
  imports: [CustomersModule, TrackingModule, SalesChannelModule, AccountingModule],
})
export class CheckoutLeadsModule {}
