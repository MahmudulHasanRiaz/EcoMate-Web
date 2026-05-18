import { Module } from '@nestjs/common';
import { CheckoutLeadsController } from './checkout-leads.controller';
import { CheckoutLeadsService } from './checkout-leads.service';

@Module({
  controllers: [CheckoutLeadsController],
  providers: [CheckoutLeadsService],
  exports: [CheckoutLeadsService],
})
export class CheckoutLeadsModule {}
