import { Module } from '@nestjs/common';
import { RtnController } from './rtn.controller';
import { RtnService } from './rtn.service';
import { OrdersModule } from '../orders/orders.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { StockModule } from '../stock/stock.module';

@Module({
  controllers: [RtnController],
  providers: [RtnService],
  exports: [RtnService],
  imports: [OrdersModule, DispatchModule, StockModule],
})
export class RtnModule {}
