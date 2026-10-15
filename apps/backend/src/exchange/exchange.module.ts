import { Module } from '@nestjs/common';
import { ExchangeController } from './exchange.controller';
import { ExchangeService } from './exchange.service';
import { OrdersModule } from '../orders/orders.module';
import { ReturnsModule } from '../returns/returns.module';

/**
 * Exchange Orders — replacement sales raised against an existing order.
 * Imports OrdersModule for the pricing recalculation and the shared stock
 * router path + ReturnsModule for the Return(EXCHANGE) leg (Task 4 Fix 8:
 * the return leg is a Return record created in the SAME transaction —
 * never a phantom Order). Deliberately does NOT import RtnModule, because
 * an exchange is an independent flow and not part of the Split/Return
 * workflow (§1).
 */
@Module({
  controllers: [ExchangeController],
  providers: [ExchangeService],
  exports: [ExchangeService],
  imports: [OrdersModule, ReturnsModule],
})
export class ExchangeModule {}