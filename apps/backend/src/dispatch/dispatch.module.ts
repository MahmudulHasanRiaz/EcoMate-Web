import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CourierManagerModule } from '../courier-manager/courier-manager.module';
import { OrdersModule } from '../orders/orders.module';
import { DispatchCancelModule } from '../dispatch-cancel/dispatch-cancel.module';

@Module({
  imports: [PrismaModule, CourierManagerModule, OrdersModule, DispatchCancelModule],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
