import { Module } from '@nestjs/common';
import { ExchangeController } from './exchange.controller';
import { ExchangeService } from './exchange.service';
import { OrdersModule } from '../orders/orders.module';

/**
 * Exchange Orders — replacement sales raised against an existing order.
 * Imports OrdersModule for the pricing recalculation and the shared stock
 * router path; deliberately does NOT import RtnModule, because an exchange is
 * an independent flow and not part of the Split/Return workflow (§1).
 */
@Module({
  controllers: [ExchangeController],
  providers: [ExchangeService],
  exports: [ExchangeService],
  imports: [OrdersModule],
})
export class ExchangeModule {}